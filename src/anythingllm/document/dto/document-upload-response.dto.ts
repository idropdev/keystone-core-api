import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsArray, IsString, IsNumber } from 'class-validator';

/**
 * Sanitized document object (infrastructure-revealing fields removed)
 */
export class SanitizedDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  wordCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  token_count_estimate?: number;
}

/**
 * Sanitized response for document upload endpoint
 * Removes infrastructure-revealing fields (location, url, name) for HIPAA compliance
 */
export class DocumentUploadResponseDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;

  @ApiPropertyOptional({ type: [SanitizedDocumentDto] })
  @IsOptional()
  @IsArray()
  documents?: SanitizedDocumentDto[];
}

