import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM Admin Invite Schemas
 *
 * These schemas define the request/response shapes for invitation management
 * endpoints in the AnythingLLM admin API.
 */

/**
 * Invite object from AnythingLLM
 */
export class InviteSchema {
  @ApiProperty({ example: 1 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'pending' })
  @IsString()
  status: string;

  @ApiProperty({ example: 'abc-123' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  @IsNumber()
  claimedBy?: number | null;
}

/**
 * Request body for creating a new invite
 */
export class CreateInviteRequestSchema {
  @ApiProperty({ example: [1, 2, 3], type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  workspaceIds: number[];
}

/**
 * Response for list invites endpoint
 */
export class ListInvitesResponseSchema {
  @ApiProperty({ type: [InviteSchema] })
  invites: InviteSchema[];
}

/**
 * Response for create invite endpoint
 */
export class CreateInviteResponseSchema {
  @ApiPropertyOptional({ type: InviteSchema })
  @IsOptional()
  invite?: InviteSchema | null;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for revoke invite endpoint
 */
export class InviteOperationResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}
