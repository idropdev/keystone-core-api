import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/**
 * Limited Document DTO
 *
 * SYSTEM-100: Tiered Document Visibility
 *
 * Used for documents where the user has LIMITED view access:
 * - Can see metadata (fileName, documentType, uploadedAt)
 * - Cannot see sensitive data (OCR results, download, etc.)
 * - Can request full access
 */
export class LimitedDocumentDto {
  @ApiProperty({
    description: 'Document UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Original file name',
    example: 'patient_record.pdf',
  })
  @Expose()
  fileName: string;

  @ApiProperty({
    description: 'Document type',
    example: 'medical_record',
  })
  @Expose()
  documentType: string;

  @ApiProperty({
    description: 'When the document was uploaded',
    example: '2024-01-15T10:30:00Z',
  })
  @Expose()
  uploadedAt: Date;

  @ApiProperty({
    description: 'User ID who uploaded the document',
    example: 123,
  })
  @Expose()
  uploadedByUserId: number;

  @ApiProperty({
    description: 'Access level for this document',
    enum: ['limited'],
    example: 'limited',
  })
  @Expose()
  accessLevel: 'limited';

  @ApiProperty({
    description: 'Whether the user can request full access',
    example: true,
  })
  @Expose()
  canRequestAccess: boolean;
}
