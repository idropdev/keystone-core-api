import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/**
 * Revocation Request Response DTO
 * 
 * Represents a revocation request workflow state.
 * 
 * HIPAA Compliance:
 * - No PHI in response
 * - Only IDs and metadata exposed
 */
export class RevocationRequestResponseDto {
  @ApiProperty({
    description: 'Revocation request ID',
    example: 1,
  })
  @Expose()
  id: number;

  @ApiProperty({
    description: 'Document ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Expose()
  documentId: string;

  @ApiProperty({
    description: 'Requester type',
    enum: ['user', 'manager'],
    example: 'user',
  })
  @Expose()
  requestedByType: 'user' | 'manager';

  @ApiProperty({
    description: 'Requester ID',
    example: 123,
  })
  @Expose()
  requestedById: number;

  @ApiProperty({
    description: 'Request type',
    enum: ['self_revocation', 'user_revocation', 'manager_revocation'],
    example: 'self_revocation',
  })
  @Expose()
  requestType: 'self_revocation' | 'user_revocation' | 'manager_revocation';

  @ApiProperty({
    description: 'Request status',
    enum: ['pending', 'approved', 'denied', 'cancelled'],
    example: 'pending',
  })
  @Expose()
  status: 'pending' | 'approved' | 'denied' | 'cancelled';

  @ApiProperty({
    description: 'If true, revoke secondary manager grants when approved',
    example: false,
  })
  @Expose()
  cascadeToSecondaryManagers: boolean;

  @ApiPropertyOptional({
    description: 'Review notes from origin manager',
    example: 'Access revoked per user request',
  })
  @Expose()
  reviewNotes?: string;

  @ApiPropertyOptional({
    description: 'User ID of origin manager who reviewed',
    example: 456,
  })
  @Expose()
  reviewedBy?: number;

  @ApiPropertyOptional({
    description: 'Review timestamp',
    example: '2025-01-20T10:30:00Z',
  })
  @Expose()
  reviewedAt?: Date;

  @ApiProperty({
    description: 'Request creation timestamp',
    example: '2025-01-20T10:00:00Z',
  })
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2025-01-20T10:30:00Z',
  })
  @Expose()
  updatedAt: Date;
}

