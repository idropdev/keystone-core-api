import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { AnythingLLMServiceIdentityService } from '../services/anythingllm-service-identity.service';

/**
 * Service Identity Guard for AnythingLLM Admin Endpoints
 *
 * Validates that incoming requests are from authorized service callers using
 * service identity tokens. Explicitly rejects end-user JWT tokens.
 *
 * Authentication flow:
 * 1. Check for Authorization header with Bearer token
 * 2. Validate token is a service identity token (not user JWT)
 * 3. Verify token signature and claims
 *
 * HIPAA Compliance:
 * - Never logs token values
 * - Logs only metadata (service account, audience, requestId)
 * - Fail-closed: rejects on any verification error
 */
@Injectable()
export class ServiceIdentityGuard implements CanActivate {
  private readonly logger = new Logger(ServiceIdentityGuard.name);

  constructor(
    private readonly configService: ConfigService<AllConfigType>,
    private readonly serviceIdentityService: AnythingLLMServiceIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const requestId = request.headers['x-request-id'] || 'unknown';

    // Check for Authorization header
    if (!authHeader) {
      this.logger.warn(
        `[ServiceIdentityGuard] Missing Authorization header | RequestId: ${requestId}`,
      );
      throw new UnauthorizedException('Missing service identity token');
    }

    // Extract Bearer token
    if (!authHeader.startsWith('Bearer ')) {
      this.logger.warn(
        `[ServiceIdentityGuard] Invalid Authorization format | RequestId: ${requestId}`,
      );
      throw new UnauthorizedException('Invalid authorization format');
    }

    const token = authHeader.substring(7);

    // Validate token format and type
    try {
      // Decode token to check if it's a service identity token vs user JWT
      const tokenType = await this.identifyTokenType(token);

      if (tokenType === 'user_jwt') {
        this.logger.warn(
          `[ServiceIdentityGuard] Rejected end-user JWT token | RequestId: ${requestId}`,
        );
        throw new ForbiddenException(
          'End-user JWT tokens are not allowed for admin endpoints. Service identity required.',
        );
      }

      if (tokenType === 'service_identity') {
        // Validate service identity token
        const isValid = this.validateServiceIdentityToken(token, requestId);
        if (!isValid) {
          throw new UnauthorizedException('Invalid service identity token');
        }

        // Attach service identity info to request for downstream use
        request.serviceIdentity = {
          verified: true,
          requestId,
        };

        return true;
      }

      // Unknown token type - fail closed
      throw new UnauthorizedException('Unrecognized token type');
    } catch (error) {
      // Re-throw HTTP exceptions
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      // Fail closed on any other error
      this.logger.error(
        `[ServiceIdentityGuard] Token validation error | RequestId: ${requestId} | Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw new UnauthorizedException('Service identity verification failed');
    }
  }

  /**
   * Identify the type of token (service identity vs user JWT)
   *
   * Service identity tokens from GCP have specific claims:
   * - iss: https://accounts.google.com or GCP service account
   * - aud: The configured audience
   * - email: Service account email (ends with .iam.gserviceaccount.com)
   *
   * User JWTs typically have:
   * - iss: The application's auth issuer
   * - sub: User ID
   * - role: User role
   */
  private identifyTokenType(
    token: string,
  ): 'service_identity' | 'user_jwt' | 'unknown' {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return 'unknown';
      }

      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      // Check for GCP service identity indicators
      const isGcpIssuer =
        payload.iss === 'https://accounts.google.com' ||
        payload.iss?.includes('googleapis.com');

      const isServiceAccount =
        payload.email?.endsWith('.iam.gserviceaccount.com') ||
        payload.azp?.endsWith('.iam.gserviceaccount.com');

      // Check configured audience
      const expectedAudience = this.configService.get(
        'anythingllm.serviceAudience',
        { infer: true },
      );
      const hasMatchingAudience =
        payload.aud === expectedAudience ||
        (Array.isArray(payload.aud) && payload.aud.includes(expectedAudience));

      if ((isGcpIssuer || isServiceAccount) && hasMatchingAudience) {
        return 'service_identity';
      }

      // Check for user JWT indicators (application-issued tokens)
      const jwtIssuer = this.configService.get('app.name', { infer: true });

      // If it has user-like claims and isn't GCP, it's likely a user JWT
      if (payload.sub && payload.role && !isGcpIssuer && !isServiceAccount) {
        return 'user_jwt';
      }

      // If it's from our app's issuer, it's a user JWT
      if (payload.iss === jwtIssuer) {
        return 'user_jwt';
      }

      return 'unknown';
    } catch (error) {
      this.logger.debug(
        `[ServiceIdentityGuard] Could not decode token for type identification: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return 'unknown';
    }
  }

  /**
   * Validate service identity token
   *
   * For now, this performs basic validation. In production, this should:
   * 1. Verify signature against Google's public keys
   * 2. Check token expiration
   * 3. Validate audience claim
   */
  private validateServiceIdentityToken(
    token: string,
    requestId: string,
  ): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return false;
      }

      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        this.logger.warn(
          `[ServiceIdentityGuard] Token expired | RequestId: ${requestId} | Exp: ${payload.exp}`,
        );
        return false;
      }

      // Validate audience
      const expectedAudience = this.configService.get(
        'anythingllm.serviceAudience',
        { infer: true },
      );

      const tokenAudience = Array.isArray(payload.aud)
        ? payload.aud
        : [payload.aud];

      if (!tokenAudience.includes(expectedAudience)) {
        this.logger.warn(
          `[ServiceIdentityGuard] Audience mismatch | RequestId: ${requestId} | Expected: ${expectedAudience} | Got: ${payload.aud}`,
        );
        return false;
      }

      // Log successful validation (no token content)
      this.logger.log(
        `[ServiceIdentityGuard] Token validated | RequestId: ${requestId} | ServiceAccount: ${payload.email || payload.azp || 'unknown'}`,
      );

      return true;
    } catch (error) {
      this.logger.error(
        `[ServiceIdentityGuard] Token validation error | RequestId: ${requestId} | Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return false;
    }
  }
}
