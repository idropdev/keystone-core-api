import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsArray,
  IsString,
  IsNumber,
} from 'class-validator';

/**
 * Sanitized document object (infrastructure-revealing fields removed)
 * Aligns with AnythingLLM document upload response structure
 */
export class SanitizedDocumentDto {
  @ApiPropertyOptional({
    description: 'Document title',
    example: 'anythingllm.txt',
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    description: 'Document author',
    example: 'Unknown',
  })
  @IsOptional()
  @IsString()
  docAuthor?: string;

  @ApiPropertyOptional({
    description: 'Document description',
    example: 'Unknown',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Document source description',
    example: 'a text file uploaded by the user.',
  })
  @IsOptional()
  @IsString()
  docSource?: string;

  @ApiPropertyOptional({
    description: 'Chunk source identifier',
    example: 'anythingllm.txt',
  })
  @IsOptional()
  @IsString()
  chunkSource?: string;

  @ApiPropertyOptional({
    description: 'Published date',
    example: '1/16/2024, 3:07:00 PM',
  })
  @IsOptional()
  @IsString()
  published?: string;

  @ApiPropertyOptional({
    description: 'Word count in document',
    example: 93,
  })
  @IsOptional()
  @IsNumber()
  wordCount?: number;

  @ApiPropertyOptional({
    description: 'Estimated token count',
    example: 115,
  })
  @IsOptional()
  @IsNumber()
  token_count_estimate?: number;
}

/**
 * Sanitized response for document upload endpoint
 * Removes infrastructure-revealing fields (location, url, name) for HIPAA compliance
 */
export class DocumentUploadResponseDto {
  @ApiProperty({
    description: 'Success indicator',
    example: true,
  })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({
    description: 'Error message if unsuccessful',
    example: null,
  })
  @IsOptional()
  error?: string | null;

  @ApiPropertyOptional({
    description: 'Array of uploaded document metadata',
    type: [SanitizedDocumentDto],
  })
  @IsOptional()
  @IsArray()
  documents?: SanitizedDocumentDto[];
}
