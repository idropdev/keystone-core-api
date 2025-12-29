import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM Admin User Schemas
 *
 * These schemas define the request/response shapes for user management
 * endpoints in the AnythingLLM admin API.
 */

export enum AdminUserRole {
  ADMIN = 'admin',
  DEFAULT = 'default',
  MANAGER = 'manager',
}

/**
 * Admin user response from AnythingLLM
 */
export class AdminUserSchema {
  @ApiProperty({ example: 1 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'admin' })
  @IsString()
  username: string;

  @ApiProperty({ example: 'admin', enum: AdminUserRole })
  @IsString()
  role: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  suspended?: number;
}

/**
 * Request body for creating a new user
 */
export class CreateUserRequestSchema {
  @ApiProperty({ example: 'new-user' })
  @IsString()
  username: string;

  @ApiProperty({ example: 'securepassword123' })
  @IsString()
  password: string;

  @ApiProperty({ example: 'default', enum: AdminUserRole })
  @IsString()
  role: string;
}

/**
 * Request body for updating an existing user
 */
export class UpdateUserRequestSchema {
  @ApiPropertyOptional({ example: 'updated-name' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ example: 'admin', enum: AdminUserRole })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  suspended?: number;
}

/**
 * Response for list users endpoint
 */
export class ListUsersResponseSchema {
  @ApiProperty({ type: [AdminUserSchema] })
  users: AdminUserSchema[];
}

/**
 * Response for create user endpoint
 */
export class CreateUserResponseSchema {
  @ApiPropertyOptional({ type: AdminUserSchema })
  @IsOptional()
  user?: AdminUserSchema | null;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for update/delete user endpoints
 */
export class UserOperationResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for is-multi-user-mode endpoint
 */
export class IsMultiUserModeResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  isMultiUser: boolean;
}
