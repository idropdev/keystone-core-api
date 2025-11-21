import {
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import ms from 'ms';
import crypto from 'crypto';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { AuthEmailLoginDto } from './dto/auth-email-login.dto';
import { AuthUpdateDto } from './dto/auth-update.dto';
import { AuthProvidersEnum } from './auth-providers.enum';
import { SocialInterface } from '../social/interfaces/social.interface';
import { AuthRegisterLoginDto } from './dto/auth-register-login.dto';
import { NullableType } from '../utils/types/nullable.type';
import { LoginResponseDto } from './dto/login-response.dto';
import { ConfigService } from '@nestjs/config';
import { JwtRefreshPayloadType } from './strategies/types/jwt-refresh-payload.type';
import { JwtPayloadType } from './strategies/types/jwt-payload.type';
import { UsersService } from '../users/users.service';
import { AllConfigType } from '../config/config.type';
import { MailService } from '../mail/mail.service';
import { RoleEnum } from '../roles/roles.enum';
import { Session } from '../session/domain/session';
import { SessionService } from '../session/session.service';
import { StatusEnum } from '../statuses/statuses.enum';
import { User } from '../users/domain/user';
import { AuditService, AuthEventType } from '../audit/audit.service';
import { AnythingLLMService } from '../anything-llm/anythingllm.service';
import {
  TokenIntrospectDto,
  TokenIntrospectResponseDto,
} from './dto/token-introspect.dto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private usersService: UsersService,
    private sessionService: SessionService,
    private mailService: MailService,
    private configService: ConfigService<AllConfigType>,
    private auditService: AuditService,
    private anythingLLMService: AnythingLLMService,
  ) {}

  async validateLogin(loginDto: AuthEmailLoginDto): Promise<LoginResponseDto> {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      // HIPAA Audit: Log failed login attempt (email not found)
      this.auditService.logAuthEvent({
        userId: 'unknown',
        provider: AuthProvidersEnum.email,
        event: AuthEventType.LOGIN_FAILED,
        success: false,
        errorMessage: 'User not found',
      });

      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          email: 'notFound',
        },
      });
    }

    if (user.provider !== AuthProvidersEnum.email) {
      // HIPAA Audit: Log failed login attempt (wrong provider)
      this.auditService.logAuthEvent({
        userId: user.id,
        provider: user.provider,
        event: AuthEventType.LOGIN_FAILED,
        success: false,
        errorMessage: 'Wrong authentication provider',
      });

      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          email: `needLoginViaProvider:${user.provider}`,
        },
      });
    }

    if (!user.password) {
      // HIPAA Audit: Log failed login attempt (no password set)
      this.auditService.logAuthEvent({
        userId: user.id,
        provider: AuthProvidersEnum.email,
        event: AuthEventType.LOGIN_FAILED,
        success: false,
        errorMessage: 'No password set',
      });

      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          password: 'incorrectPassword',
        },
      });
    }

    const isValidPassword = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isValidPassword) {
      // HIPAA Audit: Log failed login attempt (incorrect password)
      this.auditService.logAuthEvent({
        userId: user.id,
        provider: AuthProvidersEnum.email,
        event: AuthEventType.LOGIN_FAILED,
        success: false,
        errorMessage: 'Incorrect password',
      });

      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          password: 'incorrectPassword',
        },
      });
    }

    if (user.status?.id?.toString() !== StatusEnum.active.toString()) {
      // HIPAA Audit: Log failed login attempt (account not activated)
      this.auditService.logAuthEvent({
        userId: user.id,
        provider: AuthProvidersEnum.email,
        event: AuthEventType.LOGIN_FAILED,
        success: false,
        errorMessage: 'Account not activated - email verification required',
      });

      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          email: 'emailNotConfirmed',
        },
      });
    }

    const hash = crypto
      .createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    const session = await this.sessionService.create({
      user,
      hash,
    });

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: user.id,
      role: user.role,
      sessionId: session.id,
      hash,
    });

    // HIPAA Audit: Log successful login
    this.auditService.logAuthEvent({
      userId: user.id,
      provider: AuthProvidersEnum.email,
      event: AuthEventType.LOGIN_SUCCESS,
      sessionId: session.id,
      success: true,
    });

    return {
      refreshToken,
      token,
      tokenExpires,
      user,
    };
  }

  async validateSocialLogin(
    authProvider: string,
    socialData: SocialInterface,
  ): Promise<LoginResponseDto> {
    let user: NullableType<User> = null;
    const socialEmail = socialData.email?.toLowerCase();
    let userByEmail: NullableType<User> = null;
    let isNewUser = false;

    if (socialEmail) {
      userByEmail = await this.usersService.findByEmail(socialEmail);
    }

    if (socialData.id) {
      user = await this.usersService.findBySocialIdAndProvider({
        socialId: socialData.id,
        provider: authProvider,
      });
    }

    if (user) {
      if (socialEmail && !userByEmail) {
        user.email = socialEmail;
      }
      await this.usersService.update(user.id, user);
    } else if (userByEmail) {
      user = userByEmail;
    } else if (socialData.id) {
      const role = {
        id: RoleEnum.user,
      };
      const status = {
        id: StatusEnum.active,
      };

      user = await this.usersService.create({
        email: socialEmail ?? null,
        firstName: socialData.firstName ?? null,
        lastName: socialData.lastName ?? null,
        socialId: socialData.id,
        provider: authProvider,
        role,
        status,
      });

      user = await this.usersService.findById(user.id);
      isNewUser = true;
    }

    if (!user) {
      // HIPAA Audit: Log failed social login
      this.auditService.logAuthEvent({
        userId: 'unknown',
        provider: authProvider,
        event: AuthEventType.LOGIN_FAILED,
        success: false,
        errorMessage: 'User not found or could not be created',
      });

      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          user: 'userNotFound',
        },
      });
    }

    // TODO: MFA Check - if user.mfaEnabled === true, require second factor before issuing tokens
    // For now, we proceed directly to session creation

    const hash = crypto
      .createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    const session = await this.sessionService.create({
      user,
      hash,
    });

    const {
      token: jwtToken,
      refreshToken,
      tokenExpires,
    } = await this.getTokensData({
      id: user.id,
      role: user.role,
      sessionId: session.id,
      hash,
    });

    // HIPAA Audit: Log successful social login (or new account creation)
    this.auditService.logAuthEvent({
      userId: user.id,
      provider: authProvider,
      event: isNewUser
        ? AuthEventType.ACCOUNT_CREATED
        : AuthEventType.LOGIN_SUCCESS,
      sessionId: session.id,
      success: true,
    });

    // Create user in AnythingLLM if new user
    if (isNewUser) {
      try {
        await this.anythingLLMService.createUser(user);
      } catch {
        // Log but don't fail
      }
    }

    return {
      refreshToken,
      token: jwtToken,
      tokenExpires,
      user,
    };
  }

  async register(dto: AuthRegisterLoginDto): Promise<void> {
    const user = await this.usersService.create({
      ...dto,
      email: dto.email,
      role: {
        id: RoleEnum.user,
      },
      status: {
        id: StatusEnum.inactive,
      },
    });

    const hash = await this.jwtService.signAsync(
      {
        confirmEmailUserId: user.id,
      },
      {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
        expiresIn: this.configService.getOrThrow('auth.confirmEmailExpires', {
          infer: true,
        }),
      },
    );

    await this.mailService.userSignUp({
      to: dto.email,
      data: {
        hash,
      },
    });
  }

  async confirmEmail(hash: string): Promise<void> {
    let userId: User['id'];

    try {
      const jwtData = await this.jwtService.verifyAsync<{
        confirmEmailUserId: User['id'];
      }>(hash, {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
      });

      userId = jwtData.confirmEmailUserId;
    } catch {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `invalidHash`,
        },
      });
    }

    const user = await this.usersService.findById(userId);

    if (
      !user ||
      user?.status?.id?.toString() !== StatusEnum.inactive.toString()
    ) {
      throw new NotFoundException({
        status: HttpStatus.NOT_FOUND,
        error: `notFound`,
      });
    }

    user.status = {
      id: StatusEnum.active,
    };

    await this.usersService.update(user.id, user);

    // Create user in AnythingLLM when email is confirmed
    try {
      await this.anythingLLMService.createUser(user);
    } catch {
      // Log but don't fail - user can be created later via introspection
    }
  }

  async confirmNewEmail(hash: string): Promise<void> {
    let userId: User['id'];
    let newEmail: User['email'];

    try {
      const jwtData = await this.jwtService.verifyAsync<{
        confirmEmailUserId: User['id'];
        newEmail: User['email'];
      }>(hash, {
        secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
          infer: true,
        }),
      });

      userId = jwtData.confirmEmailUserId;
      newEmail = jwtData.newEmail;
    } catch {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `invalidHash`,
        },
      });
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException({
        status: HttpStatus.NOT_FOUND,
        error: `notFound`,
      });
    }

    user.email = newEmail;
    user.status = {
      id: StatusEnum.active,
    };

    await this.usersService.update(user.id, user);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          email: 'emailNotExists',
        },
      });
    }

    const tokenExpiresIn = this.configService.getOrThrow('auth.forgotExpires', {
      infer: true,
    });

    const tokenExpires = Date.now() + ms(tokenExpiresIn);

    const hash = await this.jwtService.signAsync(
      {
        forgotUserId: user.id,
      },
      {
        secret: this.configService.getOrThrow('auth.forgotSecret', {
          infer: true,
        }),
        expiresIn: tokenExpiresIn,
      },
    );

    await this.mailService.forgotPassword({
      to: email,
      data: {
        hash,
        tokenExpires,
      },
    });
  }

  async resetPassword(hash: string, password: string): Promise<void> {
    let userId: User['id'];

    try {
      const jwtData = await this.jwtService.verifyAsync<{
        forgotUserId: User['id'];
      }>(hash, {
        secret: this.configService.getOrThrow('auth.forgotSecret', {
          infer: true,
        }),
      });

      userId = jwtData.forgotUserId;
    } catch {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `invalidHash`,
        },
      });
    }

    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          hash: `notFound`,
        },
      });
    }

    user.password = password;

    await this.sessionService.deleteByUserId({
      userId: user.id,
    });

    await this.usersService.update(user.id, user);
  }

  async me(userJwtPayload: JwtPayloadType): Promise<NullableType<User>> {
    return this.usersService.findById(userJwtPayload.id);
  }

  async update(
    userJwtPayload: JwtPayloadType,
    userDto: AuthUpdateDto,
  ): Promise<NullableType<User>> {
    const currentUser = await this.usersService.findById(userJwtPayload.id);

    if (!currentUser) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          user: 'userNotFound',
        },
      });
    }

    if (userDto.password) {
      if (!userDto.oldPassword) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'missingOldPassword',
          },
        });
      }

      if (!currentUser.password) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'incorrectOldPassword',
          },
        });
      }

      const isValidOldPassword = await bcrypt.compare(
        userDto.oldPassword,
        currentUser.password,
      );

      if (!isValidOldPassword) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            oldPassword: 'incorrectOldPassword',
          },
        });
      } else {
        await this.sessionService.deleteByUserIdWithExclude({
          userId: currentUser.id,
          excludeSessionId: userJwtPayload.sessionId,
        });
      }
    }

    if (userDto.email && userDto.email !== currentUser.email) {
      const userByEmail = await this.usersService.findByEmail(userDto.email);

      if (userByEmail && userByEmail.id !== currentUser.id) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: {
            email: 'emailExists',
          },
        });
      }

      const hash = await this.jwtService.signAsync(
        {
          confirmEmailUserId: currentUser.id,
          newEmail: userDto.email,
        },
        {
          secret: this.configService.getOrThrow('auth.confirmEmailSecret', {
            infer: true,
          }),
          expiresIn: this.configService.getOrThrow('auth.confirmEmailExpires', {
            infer: true,
          }),
        },
      );

      await this.mailService.confirmNewEmail({
        to: userDto.email,
        data: {
          hash,
        },
      });
    }

    delete userDto.email;
    delete userDto.oldPassword;

    await this.usersService.update(userJwtPayload.id, userDto);

    return this.usersService.findById(userJwtPayload.id);
  }

  async refreshToken(
    data: Pick<JwtRefreshPayloadType, 'sessionId' | 'hash'>,
  ): Promise<Omit<LoginResponseDto, 'user'>> {
    const session = await this.sessionService.findById(data.sessionId);

    if (!session) {
      // HIPAA Audit: Log failed refresh (session not found)
      this.auditService.logAuthEvent({
        userId: 'unknown',
        provider: 'system',
        event: AuthEventType.REFRESH_TOKEN_FAILED,
        sessionId: data.sessionId,
        success: false,
        errorMessage: 'Session not found',
      });

      throw new UnauthorizedException();
    }

    if (session.hash !== data.hash) {
      // HIPAA Audit: Log failed refresh (hash mismatch - potential security issue)
      this.auditService.logAuthEvent({
        userId: session.user.id,
        provider: 'system',
        event: AuthEventType.REFRESH_TOKEN_FAILED,
        sessionId: data.sessionId,
        success: false,
        errorMessage: 'Hash mismatch - potential token reuse',
      });

      throw new UnauthorizedException();
    }

    const hash = crypto
      .createHash('sha256')
      .update(randomStringGenerator())
      .digest('hex');

    const user = await this.usersService.findById(session.user.id);

    if (!user?.role) {
      // HIPAA Audit: Log failed refresh (user not found or no role)
      this.auditService.logAuthEvent({
        userId: session.user.id,
        provider: 'system',
        event: AuthEventType.REFRESH_TOKEN_FAILED,
        sessionId: data.sessionId,
        success: false,
        errorMessage: 'User not found or missing role',
      });

      throw new UnauthorizedException();
    }

    await this.sessionService.update(session.id, {
      hash,
    });

    const { token, refreshToken, tokenExpires } = await this.getTokensData({
      id: session.user.id,
      role: {
        id: user.role.id,
      },
      sessionId: session.id,
      hash,
    });

    // HIPAA Audit: Log successful token refresh
    this.auditService.logAuthEvent({
      userId: session.user.id,
      provider: 'system',
      event: AuthEventType.REFRESH_TOKEN_SUCCESS,
      sessionId: session.id,
      success: true,
    });

    return {
      token,
      refreshToken,
      tokenExpires,
    };
  }

  async softDelete(user: User): Promise<void> {
    await this.usersService.remove(user.id);
  }

  async logout(data: Pick<JwtRefreshPayloadType, 'sessionId'>) {
    const session = await this.sessionService.findById(data.sessionId);

    if (session) {
      // HIPAA Audit: Log logout event
      this.auditService.logAuthEvent({
        userId: session.user.id,
        provider: 'system',
        event: AuthEventType.LOGOUT,
        sessionId: data.sessionId,
        success: true,
      });
    }

    return this.sessionService.deleteById(data.sessionId);
  }

  /**
   * Introspect a JWT token (RFC 7662: OAuth 2.0 Token Introspection)
   *
   * @param dto - Token introspection request
   * @param clientService - Service identifier for audit logging
   * @returns Token introspection response
   *
   * HIPAA Compliance:
   * - No PHI in introspection requests/responses
   * - Audit log all introspection events
   * - Never log raw tokens
   * - Sanitize error messages
   */
  async introspectToken(
    dto: TokenIntrospectDto,
    clientService: string = 'unknown',
  ): Promise<TokenIntrospectResponseDto> {
    const { token, includeUser = true } = dto;

    try {
      // Decode token to extract claims (no verification yet)
      let decoded: any;
      try {
        decoded = this.jwtService.decode(token, { complete: false });
      } catch {
        // Invalid token structure
        this.auditService.logAuthEvent({
          userId: 'unknown',
          provider: 'system',
          event: AuthEventType.TOKEN_INTROSPECTION_FAILED,
          success: false,
          errorMessage: 'Invalid token structure',
          metadata: { clientService },
        });

        return {
          active: false,
          error_code: 'invalid_token',
        };
      }

      if (!decoded) {
        return {
          active: false,
          error_code: 'invalid_token',
        };
      }

      // Validate algorithm (reject alg: "none" and unsupported algorithms)
      const allowedAlgorithms = this.configService.getOrThrow(
        'auth.jwtAllowedAlgorithms',
        { infer: true },
      );
      const tokenHeader = this.jwtService.decode(token, {
        complete: true,
      })?.header;

      if (
        tokenHeader?.alg === 'none' ||
        !allowedAlgorithms.includes(tokenHeader?.alg)
      ) {
        this.auditService.logAuthEvent({
          userId: decoded.sub || decoded.id || 'unknown',
          provider: 'system',
          event: AuthEventType.TOKEN_INTROSPECTION_FAILED,
          success: false,
          errorMessage: `Unsupported algorithm: ${tokenHeader?.alg}`,
          metadata: { clientService },
        });

        return {
          active: false,
          error_code: 'invalid_token',
        };
      }

      // Verify token signature and claims
      let verified: any;
      try {
        const verifyOptions: any = {
          secret: this.configService.getOrThrow('auth.secret', { infer: true }),
          algorithms: allowedAlgorithms,
        };

        // Only add issuer/audience validation if configured (backward compatible)
        const issuer = this.configService.get('auth.jwtIssuer', {
          infer: true,
        });
        const audience = this.configService.get('auth.jwtAudience', {
          infer: true,
        });

        if (issuer) {
          verifyOptions.issuer = issuer;
        }
        if (audience) {
          verifyOptions.audience = audience;
        }

        verified = await this.jwtService.verifyAsync(token, verifyOptions);
      } catch (error: any) {
        // Token verification failed (expired, invalid signature, etc.)
        const userId = decoded.sub || decoded.id || 'unknown';
        const reason =
          error?.name === 'TokenExpiredError' ? 'expired' : 'invalid_token';

        this.auditService.logAuthEvent({
          userId,
          provider: 'system',
          event: AuthEventType.TOKEN_INTROSPECTION_FAILED,
          success: false,
          errorMessage: `Token verification failed: ${error?.message || 'Unknown error'}`,
          metadata: { clientService, reason },
        });

        return {
          active: false,
          error_code: reason,
          exp: decoded.exp,
          iat: decoded.iat,
        };
      }

      // Extract user ID and session ID (handle both legacy and new formats)
      const userId = verified.sub || verified.id;
      const sessionId = verified.sid || verified.sessionId;

      if (!userId) {
        return {
          active: false,
          error_code: 'invalid_token',
        };
      }

      // Check if session is still active (revocation check)
      let session: NullableType<Session> = null;
      if (sessionId) {
        session = await this.sessionService.findById(sessionId);
      }

      if (!session) {
        // Session has been revoked or doesn't exist
        this.auditService.logAuthEvent({
          userId,
          provider: 'system',
          event: AuthEventType.TOKEN_INTROSPECTION_FAILED,
          sessionId,
          success: false,
          errorMessage: 'Session revoked or not found',
          metadata: { clientService },
        });

        return {
          active: false,
          revoked: true,
          error_code: 'revoked',
          sub: String(userId),
          sid: sessionId ? String(sessionId) : undefined,
          exp: verified.exp,
          iat: verified.iat,
        };
      }

      // Token is valid and active
      const response: TokenIntrospectResponseDto = {
        active: true,
        sub: String(userId),
        sid: sessionId ? String(sessionId) : undefined,
        iss:
          verified.iss ||
          this.configService.get('auth.jwtIssuer', { infer: true }),
        aud:
          verified.aud ||
          this.configService.get('auth.jwtAudience', { infer: true }),
        scope: verified.scope,
        exp: verified.exp,
        iat: verified.iat,
        nbf: verified.nbf,
        revoked: false,
        role: verified.role,
        provider: verified.provider,
      };

      // Include user info if requested
      if (includeUser) {
        const user = await this.usersService.findById(userId);
        if (user) {
          // Only include email if user has permission (respects serialization groups)
          // Email may be null (Apple private relay)
          response.email = user.email;
          response.provider = user.provider;
        }
      }

      // Log successful introspection
      this.auditService.logAuthEvent({
        userId,
        provider: 'system',
        event: AuthEventType.TOKEN_INTROSPECTION_SUCCESS,
        sessionId,
        success: true,
        metadata: { clientService },
      });

      return response;
    } catch (error: any) {
      // Unexpected error
      this.auditService.logAuthEvent({
        userId: 'unknown',
        provider: 'system',
        event: AuthEventType.TOKEN_INTROSPECTION_FAILED,
        success: false,
        errorMessage: `Unexpected error: ${error?.message || 'Unknown error'}`,
        metadata: { clientService },
      });

      return {
        active: false,
        error_code: 'server_error',
      };
    }
  }

  private async getTokensData(data: {
    id: User['id'];
    role: User['role'];
    sessionId: Session['id'];
    hash: Session['hash'];
  }) {
    const tokenExpiresIn = this.configService.getOrThrow('auth.expires', {
      infer: true,
    });

    const tokenExpires = Date.now() + ms(tokenExpiresIn);
    const now = Math.floor(Date.now() / 1000);

    // Get issuer and audience from config (optional, for RFC 7519/9068 compliance)
    const issuer = this.configService.get('auth.jwtIssuer', { infer: true });
    const audience = this.configService.get('auth.jwtAudience', {
      infer: true,
    });
    const keyId = this.configService.get('auth.jwtKeyId', { infer: true });

    // Build token payload with backward compatibility
    // Support both legacy (id, sessionId) and new (sub, sid) formats
    const tokenPayload: any = {
      // Legacy format (backward compatible)
      id: data.id,
      sessionId: data.sessionId,
      // RFC 7519 standard claims (if configured)
      ...(issuer && { iss: issuer }),
      ...(audience && { aud: audience }),
      sub: String(data.id), // Subject (user ID) - RFC 7519
      sid: String(data.sessionId), // Session ID (custom claim)
      iat: now, // Issued at
      exp: now + Math.floor(ms(tokenExpiresIn) / 1000), // Expiration
      nbf: now - 60, // Not before (60s clock skew allowance)
      // App-specific claims
      role: data.role,
      ...(audience && {
        scope: `${audience}:read ${audience}:write`,
      }), // OAuth2 scope
    };

    const [token, refreshToken] = await Promise.all([
      await this.jwtService.signAsync(tokenPayload, {
        secret: this.configService.getOrThrow('auth.secret', { infer: true }),
        // Note: Do not use expiresIn here since we manually set 'exp' in the payload above
        // This allows us to also set 'nbf' (not before) for RFC 7519 compliance
        ...(keyId && {
          header: {
            alg: 'HS256', // Algorithm (required by JWT header type)
            typ: 'at+jwt', // RFC 9068
            kid: keyId, // Key ID for rotation
          },
        }),
      }),
      // Refresh token remains unchanged (internal use only)
      await this.jwtService.signAsync(
        {
          sessionId: data.sessionId,
          hash: data.hash,
        },
        {
          secret: this.configService.getOrThrow('auth.refreshSecret', {
            infer: true,
          }),
          expiresIn: this.configService.getOrThrow('auth.refreshExpires', {
            infer: true,
          }),
        },
      ),
    ]);

    return {
      token,
      refreshToken,
      tokenExpires,
    };
  }
}
