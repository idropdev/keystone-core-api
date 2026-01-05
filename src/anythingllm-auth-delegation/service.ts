import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import { JwtSignerPort } from './infrastructure/jwt/jwt-signer.port';
import { KeystorePort } from './infrastructure/keystore/keystore.port';
import { DelegatedTokenClaims, ActorClaim } from './domain/delegated-token-claims.entity';
import {
  IssueDelegatedTokenDto,
  RequesterContextDto,
} from './dto/issue-delegated-token.dto';
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
    const enabled = this.configService.get<boolean>(
      'anythingllm.enableDelegatedTokens',
      { infer: true },
    ) ?? false;

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4b3ccba3-55b0-467b-8ddb-33cba3067360',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'anythingllm-auth-delegation/service.ts:38',message:'Checking delegated token config',data:{enabled,envVar:process.env.ENABLE_DELEGATED_TOKENS},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H'})}).catch(()=>{});
    // #endregion

    if (!enabled) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/4b3ccba3-55b0-467b-8ddb-33cba3067360',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'anythingllm-auth-delegation/service.ts:44',message:'Delegated tokens disabled',data:{enabled},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H'})}).catch(()=>{});
      // #endregion
      throw new Error(
        'Delegated token issuance is disabled. Set ENABLE_DELEGATED_TOKENS=true',
      );
    }

    const expiresIn = this.configService.get<number>(
      'anythingllm.delegatedTokenExpiresIn',
      { infer: true },
    ) ?? 300; // Default: 5 minutes

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
    const tokenPayload: DelegatedTokenClaims = {
      sub: 'svc-keystone', // Service identity
      act: actorClaim, // Actor claim (RFC 8693)
      scope: dto.scope,
      aud: audience,
      iat: now,
      exp: expiresAt,
      ...(issuer && { iss: issuer }),
      nbf: now - 60, // Not before (60s clock skew allowance)
    };


    // Sign token
    const token = await this.jwtSigner.sign(
      tokenPayload as unknown as Record<string, unknown>,
      secret,
      expiresIn,
    );

    // HIPAA-compliant audit logging (no PHI, no tokens)
    this.logger.debug(
      `Issued delegated token for operation: ${dto.operation}, userId: ${dto.requesterContext.userId}, scope: ${dto.scope.join(',')}`,
    );

    return {
      token,
      expiresIn,
      expiresAt,
      audience,
    };
  }
}

