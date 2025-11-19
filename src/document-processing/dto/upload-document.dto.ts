import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DocumentType } from '../domain/enums/document-type.enum';

export class UploadDocumentDto {
  @ApiProperty({
    enum: DocumentType,
    description: 'Type of medical document',
    example: DocumentType.LAB_RESULT,
  })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiProperty({
    description: 'Optional user description',
    required: false,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
