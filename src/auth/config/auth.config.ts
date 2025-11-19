import { registerAs } from '@nestjs/config';

import { IsString, IsOptional, IsNumber } from 'class-validator';
import validateConfig from '../../utils/validate-config';
import { AuthConfig } from './auth-config.type';
import ms from 'ms';

class EnvironmentVariablesValidator {
  @IsString()
  AUTH_JWT_SECRET: string;

  @IsString()
  AUTH_JWT_TOKEN_EXPIRES_IN: string;

  @IsString()
  AUTH_REFRESH_SECRET: string;

  @IsString()
  AUTH_REFRESH_TOKEN_EXPIRES_IN: string;

  @IsString()
  AUTH_FORGOT_SECRET: string;

  @IsString()
  AUTH_FORGOT_TOKEN_EXPIRES_IN: string;

  @IsString()
  AUTH_CONFIRM_EMAIL_SECRET: string;

  @IsString()
  AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN: string;

  // Token introspection
  @IsString()
  @IsOptional()
  AUTH_INTROSPECTION_SERVICE_KEY?: string;

  @IsNumber()
  @IsOptional()
  AUTH_INTROSPECTION_RATE_LIMIT?: number;

  // JWT standards
  @IsString()
  @IsOptional()
  AUTH_JWT_ISSUER?: string;

  @IsString()
  @IsOptional()
  AUTH_JWT_AUDIENCE?: string;

  @IsString()
  @IsOptional()
  AUTH_JWT_KEY_ID?: string;

  @IsString()
  @IsOptional()
  AUTH_JWT_ALLOWED_ALGORITHMS?: string;
}

export default registerAs<AuthConfig>('auth', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    secret: process.env.AUTH_JWT_SECRET,
    expires: process.env.AUTH_JWT_TOKEN_EXPIRES_IN as ms.StringValue,
    refreshSecret: process.env.AUTH_REFRESH_SECRET,
    refreshExpires: process.env.AUTH_REFRESH_TOKEN_EXPIRES_IN as ms.StringValue,
    forgotSecret: process.env.AUTH_FORGOT_SECRET,
    forgotExpires: process.env.AUTH_FORGOT_TOKEN_EXPIRES_IN as ms.StringValue,
    confirmEmailSecret: process.env.AUTH_CONFIRM_EMAIL_SECRET,
    confirmEmailExpires: process.env
      .AUTH_CONFIRM_EMAIL_TOKEN_EXPIRES_IN as ms.StringValue,
    // Token introspection
    introspectionServiceKey: process.env.AUTH_INTROSPECTION_SERVICE_KEY,
    introspectionRateLimit: process.env.AUTH_INTROSPECTION_RATE_LIMIT
      ? parseInt(process.env.AUTH_INTROSPECTION_RATE_LIMIT, 10)
      : 100,
    // JWT standards
    jwtIssuer: process.env.AUTH_JWT_ISSUER,
    jwtAudience: process.env.AUTH_JWT_AUDIENCE,
    jwtKeyId: process.env.AUTH_JWT_KEY_ID || 'hmac-2025-01',
    jwtAllowedAlgorithms: process.env.AUTH_JWT_ALLOWED_ALGORITHMS
      ? process.env.AUTH_JWT_ALLOWED_ALGORITHMS.split(',').map((a) => a.trim())
      : ['HS256'],
  };
});
