import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * AnythingLLM Auth Schemas
 *
 * These schemas define the request/response shapes for authentication
 * endpoints in the AnythingLLM API.
 */

/**
 * Response for auth verification endpoint
 */
export class AuthVerificationResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  authenticated: boolean;
}





