import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/**
 * Access Grant Response DTO
 * 
 * Represents an access grant for a document.
 * 
 * HIPAA Compliance:
 * - No PHI in response
 * - Only IDs and metadata exposed
 */
export class AccessGrantResponseDto {
  @ApiProperty({
    description: 'Access grant ID',
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
    description: 'Subject type (who receives the grant)',
    enum: ['user', 'manager'],
    example: 'user',
  })
  @Expose()
  subjectType: 'user' | 'manager';

  @ApiProperty({
    description: 'Subject ID (user ID or manager ID)',
    example: 123,
  })
  @Expose()
  subjectId: number;

  @ApiProperty({
    description: 'Grant type (authority level)',
    enum: ['owner', 'delegated', 'derived'],
    example: 'delegated',
  })
  @Expose()
  grantType: 'owner' | 'delegated' | 'derived';

  @ApiProperty({
    description: 'Grantor type (who created the grant)',
    enum: ['user', 'manager'],
    example: 'manager',
  })
  @Expose()
  grantedByType: 'user' | 'manager';

  @ApiProperty({
    description: 'Grantor ID (user ID or manager ID who created the grant)',
    example: 456,
  })
  @Expose()
  grantedById: number;

  @ApiProperty({
    description: 'Grant creation timestamp',
    example: '2025-01-20T10:30:00Z',
  })
  @Expose()
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'Grant revocation timestamp (null if active)',
    example: null,
    nullable: true,
  })
  @Expose()
  revokedAt?: Date | null;

  @ApiPropertyOptional({
    description: 'Revoker type (who revoked the grant, if applicable)',
    enum: ['user', 'manager'],
    example: null,
    nullable: true,
  })
  @Expose()
  revokedByType?: 'user' | 'manager' | null;

  @ApiPropertyOptional({
    description: 'Revoker ID (who revoked the grant, if applicable)',
    example: null,
    nullable: true,
  })
  @Expose()
  revokedById?: number | null;
}

