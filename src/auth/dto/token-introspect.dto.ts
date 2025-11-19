import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for token introspection request (RFC 7662)
 *
 * HIPAA Compliance:
 * - Token introspection is a service-to-service operation
 * - Requires service API key authentication (not public endpoint)
 * - No PHI should be included in request/response
 */
export class TokenIntrospectDto {
  @ApiProperty({
    description: 'JWT access token to introspect',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  token: string;

  @ApiPropertyOptional({
    description: 'Token type hint (RFC 7662)',
    example: 'access_token',
  })
  @IsOptional()
  @IsString()
  tokenTypeHint?: string;

  @ApiPropertyOptional({
    description: 'Whether to include user information in response',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeUser?: boolean;
}

/**
 * DTO for token introspection response (RFC 7662 compliant)
 *
 * HIPAA Compliance:
 * - Contains only non-PHI user identifiers (sub, role)
 * - No email, name, or other PHI in response (unless explicitly requested)
 * - Session ID included for audit purposes
 */
export class TokenIntrospectResponseDto {
  @ApiProperty({
    description: 'Whether the token is active (RFC 7662 required field)',
    example: true,
  })
  active: boolean;

  @ApiPropertyOptional({
    description: 'Subject (user ID) - RFC 7519 standard claim',
    example: '123',
  })
  sub?: string;

  @ApiPropertyOptional({
    description: 'Session ID (custom claim)',
    example: '456',
  })
  sid?: string;

  @ApiPropertyOptional({
    description: 'Issuer - RFC 7519 standard claim',
    example: 'https://keystone.example.com',
  })
  iss?: string;

  @ApiPropertyOptional({
    description: 'Audience - RFC 7519 standard claim',
    example: 'anythingllm',
  })
  aud?: string;

  @ApiPropertyOptional({
    description: 'OAuth2 scope - RFC 7662 standard claim',
    example: 'anythingllm:read anythingllm:write',
  })
  scope?: string;

  @ApiPropertyOptional({
    description: 'Expiration timestamp - RFC 7519 standard claim',
    example: 1738000900,
  })
  exp?: number;

  @ApiPropertyOptional({
    description: 'Issued at timestamp - RFC 7519 standard claim',
    example: 1738000000,
  })
  iat?: number;

  @ApiPropertyOptional({
    description: 'Not before timestamp - RFC 7519 standard claim',
    example: 1737999940,
  })
  nbf?: number;

  @ApiPropertyOptional({
    description: 'Whether the token has been revoked',
    example: false,
  })
  revoked?: boolean;

  @ApiPropertyOptional({
    description: 'User role information (app-specific, non-PHI)',
    type: 'object',
    example: { id: 2, name: 'user' },
    additionalProperties: true,
  })
  role?: { id: number | string; name?: string };

  @ApiPropertyOptional({
    description: 'Authentication provider (app-specific)',
    example: 'google',
  })
  provider?: string;

  @ApiPropertyOptional({
    description: 'User email (only if includeUser=true, may be null)',
    example: null,
  })
  email?: string | null;

  @ApiPropertyOptional({
    description: 'Non-sensitive error code (only when active=false)',
    example: 'expired',
  })
  error_code?: string;
}
