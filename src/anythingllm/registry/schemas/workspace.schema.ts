import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM Workspace Schemas
 *
 * These schemas define the request/response shapes for workspace management
 * endpoints in the AnythingLLM API.
 */

/**
 * Document object in workspace
 */
export class WorkspaceDocumentSchema {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  location: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * Thread object in workspace
 */
export class WorkspaceThreadSchema {
  @ApiProperty()
  @IsString()
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  userId?: number;
}

/**
 * Request body for creating a workspace
 */
export class CreateWorkspaceRequestSchema {
  @ApiProperty({ example: 'My New Workspace' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'my-workspace' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: 0.7 })
  @IsOptional()
  @IsNumber()
  similarityThreshold?: number;

  @ApiPropertyOptional({ example: 0.7 })
  @IsOptional()
  @IsNumber()
  openAiTemp?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber()
  openAiHistory?: number;

  @ApiPropertyOptional({ example: 'Custom prompt for responses' })
  @IsOptional()
  @IsString()
  openAiPrompt?: string;

  @ApiPropertyOptional({ example: 'Custom refusal message' })
  @IsOptional()
  @IsString()
  queryRefusalResponse?: string;

  @ApiPropertyOptional({ example: 'chat' })
  @IsOptional()
  @IsString()
  chatMode?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsNumber()
  topN?: number;
}

/**
 * Request body for updating a workspace
 */
export class UpdateWorkspaceRequestSchema {
  @ApiPropertyOptional({ example: 'Updated Workspace Name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

/**
 * Request body for updating workspace embeddings
 */
export class UpdateWorkspaceEmbeddingsRequestSchema {
  @ApiPropertyOptional({ example: ['doc1.json', 'doc2.json'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  adds?: string[];

  @ApiPropertyOptional({ example: ['doc3.json'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deletes?: string[];
}

/**
 * Request body for updating document pin status
 */
export class UpdateWorkspacePinRequestSchema {
  @ApiProperty({ example: 'doc1.json' })
  @IsString()
  docPath: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  pinned: boolean;
}

/**
 * Workspace response object
 */
export class WorkspaceResponseSchema {
  @ApiProperty()
  @IsNumber()
  id: number;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  slug: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lastUpdatedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  openAiTemp?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  openAiHistory?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  openAiPrompt?: string | null;

  @ApiPropertyOptional({ type: [WorkspaceDocumentSchema] })
  @IsOptional()
  @IsArray()
  documents?: WorkspaceDocumentSchema[];

  @ApiPropertyOptional({ type: [WorkspaceThreadSchema] })
  @IsOptional()
  @IsArray()
  threads?: WorkspaceThreadSchema[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

/**
 * Response for create workspace endpoint
 */
export class CreateWorkspaceResponseSchema {
  @ApiProperty({ type: WorkspaceResponseSchema })
  @IsObject()
  workspace: WorkspaceResponseSchema;

  @ApiProperty({ example: 'Workspace created' })
  @IsString()
  message: string;
}

/**
 * Response for list workspaces endpoint
 */
export class ListWorkspacesResponseSchema {
  @ApiProperty({ type: [WorkspaceResponseSchema] })
  @IsArray()
  workspaces: WorkspaceResponseSchema[];
}

/**
 * Response for update workspace endpoint
 */
export class UpdateWorkspaceResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ type: WorkspaceResponseSchema })
  @IsOptional()
  workspace?: WorkspaceResponseSchema;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for delete workspace endpoint
 */
export class DeleteWorkspaceResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for update embeddings endpoint
 */
export class UpdateWorkspaceEmbeddingsResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for update pin endpoint
 */
export class UpdateWorkspacePinResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}



