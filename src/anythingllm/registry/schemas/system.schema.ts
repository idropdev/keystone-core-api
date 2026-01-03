import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM System Schemas
 *
 * These schemas define the request/response shapes for system-level
 * endpoints in the AnythingLLM API.
 */

/**
 * Chat export object
 */
export class ChatExportSchema {
  @ApiProperty()
  @IsNumber()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  workspaceId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  response?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  userId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  threadSlug?: string;
}

/**
 * Response for export chats endpoint
 */
export class ExportChatsResponseSchema {
  @ApiProperty({ type: [ChatExportSchema] })
  @IsArray()
  chats: ChatExportSchema[];
}



