import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/**
 * Access Request Response DTO
 *
 * SYSTEM-100: Access Request Workflow
 */
export class AccessRequestResponseDto {
  @ApiProperty({ description: 'Access request ID' })
  @Expose()
  id: number;

  @ApiProperty({ description: 'Document UUID' })
  @Expose()
  documentId: string;

  @ApiProperty({ description: 'Manager ID who requested access' })
  @Expose()
  requestedByManagerId: number;

  @ApiProperty({
    description: 'Request status',
    enum: ['pending', 'approved', 'denied'],
  })
  @Expose()
  status: 'pending' | 'approved' | 'denied';

  @ApiPropertyOptional({ description: 'Reason for requesting access' })
  @Expose()
  requestReason?: string;

  @ApiPropertyOptional({ description: 'Manager ID who reviewed the request' })
  @Expose()
  reviewedByManagerId?: number;

  @ApiPropertyOptional({ description: 'When the request was reviewed' })
  @Expose()
  reviewedAt?: Date;

  @ApiPropertyOptional({ description: 'Review notes' })
  @Expose()
  reviewNotes?: string;

  @ApiProperty({ description: 'When the request was created' })
  @Expose()
  createdAt: Date;
}
