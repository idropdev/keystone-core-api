import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
  IsBoolean,
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

/**
 * Response for auth check endpoint
 */
export class AuthCheckResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  authenticated: boolean;
}

/**
 * Response for check token endpoint
 */
export class CheckTokenResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  authenticated: boolean;
}

/**
 * Response for system info endpoint
 */
export class SystemInfoResponseSchema {
  @ApiProperty({ example: '1.0.0' })
  @IsString()
  version: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  info?: Record<string, unknown>;
}

/**
 * Response for vector count endpoint
 * Matches AnythingLLM API: GET /v1/system/vector-count
 */
export class VectorCountResponseSchema {
  @ApiProperty({
    example: 5450,
    description: 'Number of all vectors in connected vector database',
  })
  @IsNumber()
  vectorCount: number;
}

/**
 * Response for workspace count endpoint
 */
export class WorkspaceCountResponseSchema {
  @ApiProperty({ example: 10 })
  @IsNumber()
  count: number;
}

/**
 * Response for document count endpoint
 */
export class DocumentCountResponseSchema {
  @ApiProperty({ example: 50 })
  @IsNumber()
  count: number;
}
