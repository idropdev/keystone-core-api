import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DocumentUploadRequestDto {
  @ApiPropertyOptional({
    type: 'string',
    description: 'Comma-separated workspace slugs to embed document into',
    example: 'workspace1,workspace2',
  })
  @IsOptional()
  @IsString()
  addToWorkspaces?: string;

  @ApiPropertyOptional({
    type: 'string',
    description: 'JSON array string of OCR fields from Google OCR',
    example: '[{"fieldKey":"lab_test_value","fieldValue":"6.3 x10^3/uL","fieldType":"lab_test_value","confidence":0.85}]',
  })
  @IsOptional()
  @IsString()
  externalOCRFields?: string;
}

