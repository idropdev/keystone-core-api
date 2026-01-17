import { Injectable, Logger, Inject } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { JwtSignerPort } from './infrastructure/jwt/jwt-signer.port';
import { KeystorePort } from './infrastructure/keystore/keystore.port';
import {
  DelegatedTokenClaims,
  ActorClaim,
} from './domain/delegated-token-claims.entity';
import { IssueDelegatedTokenDto } from './dto/issue-delegated-token.dto';
import { DelegatedTokenResponseDto } from './dto/delegated-token-response.dto';

/**
 * Service for issuing delegated S2S tokens with embedded requester context
 * Implements RFC 8693-like token exchange pattern
 */
@Injectable()
export class AnythingLLMAuthDelegationService {
  private readonly logger = new Logger(AnythingLLMAuthDelegationService.name);

  constructor(
    @Inject('JwtSignerPort')
    private readonly jwtSigner: JwtSignerPort,
    @Inject('KeystorePort')
    private readonly keystore: KeystorePort,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  /**
   * Issue a delegated token with embedded requester context
   *
   * @param dto - Token issuance request
   * @returns Promise resolving to delegated token response
   */
  async issueDelegatedToken(
    dto: IssueDelegatedTokenDto,
  ): Promise<DelegatedTokenResponseDto> {
    const enabled =
      this.configService.get<boolean>('anythingllm.enableDelegatedTokens', {
        infer: true,
      }) ?? false;

    if (!enabled) {
      const errorMessage =
        'Delegated token issuance is disabled. Set ENABLE_DELEGATED_TOKENS=true. Delegated tokens (HS256) are required for AnythingLLM authentication. Do not use service identity (RS256) tokens.';
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    // Ensure requesterContext is provided - use system admin if not provided
    // This ensures delegated tokens are always used, never service identity
    if (!dto.requesterContext || !dto.requesterContext.userId) {
      this.logger.warn(
        'No requesterContext provided, using system admin (ID: 1) for delegated token',
      );
      dto.requesterContext = {
        userId: '1', // System admin ID
        roles: ['admin'],
      };
    }

    const expiresIn =
      this.configService.get<number>('anythingllm.delegatedTokenExpiresIn', {
        infer: true,
      }) ?? 300; // Default: 5 minutes

    const audience =
      this.configService.get<string>('anythingllm.delegatedTokenAudience', {
        infer: true,
      }) ?? 'anythingllm';

    const secret = await this.keystore.getDelegatedTokenSecret();
    const issuer = await this.keystore.getIssuer();

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + expiresIn;

    // Build actor claim
    const actorClaim: ActorClaim = {
      sub: dto.requesterContext.userId,
      roles: dto.requesterContext.roles,
      ...(dto.requesterContext.sessionId && {
        sessionId: dto.requesterContext.sessionId,
      }),
      ...(dto.requesterContext.provider && {
        provider: dto.requesterContext.provider,
      }),
    };

    // Build token payload
    // CRITICAL: Issuer is required for AnythingLLM validation
    // AnythingLLM expects one of: anythingllm-internal, http://localhost:3000/api, http://localhost:3000
    // If issuer is not set, use default that matches AnythingLLM expectations
    const finalIssuer = issuer || 'http://localhost:3000/api';

    const tokenPayload: DelegatedTokenClaims = {
      sub: 'svc-keystone', // Service identity
      act: actorClaim, // Actor claim (RFC 8693)
      scope: dto.scope,
      aud: audience,
      iat: now,
      exp: expiresAt,
      iss: finalIssuer, // Always include issuer (required by AnythingLLM)
      nbf: now - 60, // Not before (60s clock skew allowance)
    };

    // Sign token - MUST use HS256 (not RS256)
    const token = await this.jwtSigner.sign(
      tokenPayload as unknown as Record<string, unknown>,
      secret,
      expiresIn,
    );

    // Verify token algorithm after signing (defensive check)
    try {
      const decoded = jwt.decode(token, { complete: true }) as any;

      if (decoded?.header?.alg !== 'HS256') {
        const errorMessage = `CRITICAL: Delegated token was signed with algorithm ${decoded?.header?.alg} but MUST be HS256. Check JwtSignerAdapter configuration.`;
        this.logger.error(errorMessage);
        throw new Error(errorMessage);
      }
      this.logger.debug(
        `Issued delegated token (HS256) for operation: ${dto.operation}, userId: ${dto.requesterContext.userId}, scope: ${dto.scope.join(',')}`,
      );
    } catch (verifyErr) {
      const errorMessage =
        verifyErr instanceof Error
          ? verifyErr.message
          : 'Failed to verify delegated token algorithm';
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    return {
      token,
      expiresIn,
      expiresAt,
      audience,
    };
  }
}
