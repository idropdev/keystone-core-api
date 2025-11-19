import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';

/**
 * Service API Key Guard for token introspection endpoint
 *
 * RFC 7662 requires authenticated callers for introspection endpoint.
 * This guard validates the service API key from Authorization header.
 *
 * HIPAA Compliance:
 * - Service-to-service authentication prevents unauthorized access
 * - API key must be stored in GCP Secret Manager in production
 * - Never log the API key value
 */
@Injectable()
export class ServiceApiKeyGuard implements CanActivate {
  constructor(private configService: ConfigService<AllConfigType>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid service API key');
    }

    const providedKey = authHeader.substring(7); // Remove 'Bearer '
    const expectedKey = this.configService.getOrThrow(
      'auth.introspectionServiceKey',
      { infer: true },
    );

    if (providedKey !== expectedKey) {
      throw new UnauthorizedException('Invalid service API key');
    }

    return true;
  }
}
