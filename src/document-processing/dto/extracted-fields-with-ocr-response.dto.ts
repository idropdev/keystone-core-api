import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { ExtractedFieldResponseDto } from './extracted-field-response.dto';

export class ExtractedFieldsWithOcrResponseDto {
  @ApiProperty({
    description: 'Array of extracted fields from the document',
    type: [ExtractedFieldResponseDto],
  })
  @Expose()
  fields: ExtractedFieldResponseDto[];

  @ApiProperty({
    description:
      'Document AI OCR output (raw OCR result from Google Document AI). Contains text, confidence, pageCount, entities, and fullResponse.',
    required: false,
  })
  @Expose()
  document_output?: any;

  @ApiProperty({
    description:
      'Vision AI OCR output (raw OCR result from Google Vision AI). Contains text, confidence, pageCount, entities, and fullResponse.',
    required: false,
  })
  @Expose()
  vision_output?: any;
}
