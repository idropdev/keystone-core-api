import { IsOptional, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM Admin Preferences Schemas
 *
 * These schemas define the request/response shapes for system preferences
 * endpoints in the AnythingLLM admin API.
 */

/**
 * Request body for updating preferences
 * Accepts any key-value pairs for flexible preference updates
 */
export class UpdatePreferencesRequestSchema {
  @ApiPropertyOptional({ example: 'support@example.com' })
  @IsOptional()
  support_email?: string;

  // Allow additional dynamic properties
  [key: string]: unknown;
}

/**
 * Response for update preferences endpoint
 */
export class UpdatePreferencesResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
}
