import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { OrNeverType } from '../../utils/types/or-never.type';
import { JwtPayloadType } from './types/jwt-payload.type';
import { AllConfigType } from '../../config/config.type';
import { SessionService } from '../../session/session.service';
import { AuditService, AuthEventType } from '../../audit/audit.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    configService: ConfigService<AllConfigType>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow('auth.secret', { infer: true }),
    });
  }

  // Why we don't check if the user exists in the database:
  // https://github.com/brocoders/nestjs-boilerplate/blob/main/docs/auth.md#about-jwt-strategy
  // However, we MUST check if the session is still active to properly invalidate tokens after logout.
  public async validate(
    payload: JwtPayloadType | any, // Allow any for backward compatibility
  ): Promise<OrNeverType<JwtPayloadType>> {
    // Handle both legacy (id, sessionId) and new (sub, sid) formats
    const userId = payload.sub || payload.id;
    const sessionId = payload.sid || payload.sessionId;

    if (!userId) {
      throw new UnauthorizedException();
    }

    // Normalize to JwtPayloadType format
    const normalizedPayload: JwtPayloadType = {
      id: userId,
      role: payload.role,
      sessionId: sessionId,
      iat: payload.iat,
      exp: payload.exp,
    };

    // CRITICAL: Verify that the session is still active.
    // This ensures tokens are immediately invalidated after logout.
    // Without this check, access tokens would remain valid until expiry even after logout,
    // which is a security vulnerability and HIPAA compliance issue.
    if (normalizedPayload.sessionId) {
      const session = await this.sessionService.findById(
        normalizedPayload.sessionId,
      );
      if (!session) {
        // HIPAA Audit: Log invalid session attempt (critical for security monitoring)
        // This catches attempts to use tokens after logout or session expiration
        this.auditService.logAuthEvent({
          userId: normalizedPayload.id,
          provider: 'system',
          event: AuthEventType.INVALID_SESSION,
          sessionId: normalizedPayload.sessionId,
          success: false,
          errorMessage:
            'Session not found or has been invalidated (logged out)',
        });

        // Session has been deleted (logged out) or doesn't exist
        throw new UnauthorizedException();
      }
    }

    return normalizedPayload;
  }
}
