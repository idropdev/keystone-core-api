import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsObject,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM Document Schemas
 *
 * These schemas define the request/response shapes for document management
 * endpoints in the AnythingLLM API.
 */

/**
 * Document metadata object
 */
export class DocumentMetadataSchema {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  docAuthor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  docSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chunkSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  published?: string;
}

/**
 * Document object from AnythingLLM
 */
export class DocumentSchema {
  @ApiProperty()
  @IsString()
  location: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  docAuthor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  docSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chunkSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  published?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  wordCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  token_count_estimate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;
}

/**
 * Request body for uploading a link
 */
export class UploadLinkRequestSchema {
  @ApiProperty({ example: 'https://example.com' })
  @IsString()
  link: string;

  @ApiPropertyOptional({ example: 'workspace1,workspace2' })
  @IsOptional()
  @IsString()
  addToWorkspaces?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  scraperHeaders?: Record<string, string>;
}

/**
 * Request body for uploading raw text
 */
export class UploadRawTextRequestSchema {
  @ApiProperty({ example: 'This is the document content...' })
  @IsString()
  text: string;

  @ApiPropertyOptional({ type: DocumentMetadataSchema })
  @IsOptional()
  metadata?: DocumentMetadataSchema;
}

/**
 * Request body for moving files
 */
export class MoveFilesRequestSchema {
  @ApiProperty({ example: ['doc1.json', 'doc2.json'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  sourcePaths: string[];

  @ApiProperty({ example: 'target-folder' })
  @IsString()
  targetFolder: string;
}

/**
 * Response for document upload endpoints
 */
export class DocumentUploadResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;

  @ApiPropertyOptional({ type: [DocumentSchema] })
  @IsOptional()
  @IsArray()
  documents?: DocumentSchema[];
}

/**
 * Response for list documents endpoint
 */
export class ListDocumentsResponseSchema {
  @ApiProperty({ type: [DocumentSchema] })
  @IsArray()
  documents: DocumentSchema[];
}

/**
 * Response for get document endpoint
 */
export class GetDocumentResponseSchema {
  @ApiProperty({ type: DocumentSchema })
  document: DocumentSchema;
}

/**
 * Response for accepted file types endpoint
 */
export class AcceptedFileTypesResponseSchema {
  @ApiProperty({ example: ['.pdf', '.txt', '.docx'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  types: string[];
}

/**
 * Response for metadata schema endpoint
 */
export class MetadataSchemaResponseSchema {
  @ApiProperty({ type: DocumentMetadataSchema })
  schema: DocumentMetadataSchema;
}

/**
 * Response for create folder endpoint
 */
export class CreateFolderResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for remove folder endpoint
 */
export class RemoveFolderResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for move files endpoint
 */
export class MoveFilesResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}



