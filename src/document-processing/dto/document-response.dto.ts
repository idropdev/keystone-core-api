import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { DocumentStatus } from '../domain/enums/document-status.enum';
import { DocumentType } from '../domain/enums/document-type.enum';
import { ProcessingMethod } from '../domain/enums/processing-method.enum';

export class DocumentResponseDto {
  @ApiProperty()
  @Expose()
  id: string;

  @ApiProperty({ enum: DocumentType })
  @Expose()
  documentType: DocumentType;

  @ApiProperty({ enum: DocumentStatus })
  @Expose()
  status: DocumentStatus;

  @ApiProperty({
    enum: ProcessingMethod,
    required: false,
    description: 'How the document was processed',
  })
  @Expose()
  processingMethod?: ProcessingMethod;

  @ApiProperty()
  @Expose()
  fileName: string;

  @ApiProperty()
  @Expose()
  fileSize: number;

  @ApiProperty()
  @Expose()
  mimeType: string;

  @ApiProperty({ required: false })
  @Expose()
  description?: string;

  @ApiProperty({ required: false })
  @Expose()
  confidence?: number;

  @ApiProperty({ required: false })
  @Expose()
  errorMessage?: string;

  @ApiProperty()
  @Expose()
  uploadedAt: Date;

  @ApiProperty({ required: false })
  @Expose()
  processedAt?: Date;

  @ApiProperty()
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description: 'Origin manager ID (Manager ID, not User ID)',
  })
  @Expose()
  originManagerId: number;

  // SECURITY: Never expose GCS URIs, full OCR output, or internal IDs
}
