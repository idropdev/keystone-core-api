import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM Admin Workspace Schemas
 *
 * These schemas define the request/response shapes for workspace management
 * endpoints in the AnythingLLM admin API.
 */

/**
 * Workspace user object from AnythingLLM
 */
export class WorkspaceUserSchema {
  @ApiProperty({ example: 1 })
  @IsNumber()
  userId: number;

  @ApiPropertyOptional({ example: 'admin' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({ example: 'admin' })
  @IsString()
  role: string;
}

/**
 * Request body for managing workspace users
 */
export class ManageWorkspaceUsersRequestSchema {
  @ApiProperty({ example: [1, 2, 4], type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  userIds: number[];

  @ApiProperty({ example: false })
  @IsBoolean()
  reset: boolean;
}

/**
 * Response for get workspace users endpoint
 */
export class GetWorkspaceUsersResponseSchema {
  @ApiProperty({ type: [WorkspaceUserSchema] })
  users: WorkspaceUserSchema[];
}

/**
 * Response for manage workspace users endpoint
 */
export class ManageWorkspaceUsersResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;

  @ApiPropertyOptional({ type: [WorkspaceUserSchema] })
  @IsOptional()
  users?: WorkspaceUserSchema[];
}

/**
 * Request body for workspace chats
 */
export class WorkspaceChatsRequestSchema {
  @ApiProperty({ example: 0 })
  @IsNumber()
  offset: number;
}

/**
 * Chat object from workspace chats endpoint
 */
export class WorkspaceChatSchema {
  @ApiProperty()
  id: number;

  @ApiPropertyOptional()
  @IsOptional()
  workspaceId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  prompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  response?: string;

  @ApiPropertyOptional()
  @IsOptional()
  createdAt?: string;
}

/**
 * Response for workspace chats endpoint
 */
export class WorkspaceChatsResponseSchema {
  @ApiProperty({ type: [WorkspaceChatSchema] })
  chats: WorkspaceChatSchema[];

  @ApiProperty({ example: true })
  @IsBoolean()
  hasPages: boolean;
}
