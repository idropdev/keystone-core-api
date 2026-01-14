import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

/**
 * User Manager Assignment Response DTO
 *
 * Represents a user-manager assignment relationship.
 *
 * HIPAA Compliance:
 * - No PHI in response
 * - Only IDs and metadata exposed
 */
export class UserManagerAssignmentResponseDto {
  @ApiProperty({
    description: 'Assignment ID',
    example: 789,
  })
  @Expose()
  id: number;

  @ApiProperty({
    description: 'User ID',
    example: 456,
  })
  @Expose()
  userId: number;

  @ApiProperty({
    description: 'Manager ID',
    example: 123,
  })
  @Expose()
  managerId: number;

  @ApiProperty({
    description: 'ID of user who created the assignment (admin)',
    example: 1,
  })
  @Expose()
  assignedById: number;

  @ApiProperty({
    description: 'Assignment creation timestamp',
    example: '2025-01-20T16:00:00Z',
  })
  @Expose()
  assignedAt: Date;

  @ApiProperty({
    description: 'Assignment status (active if not deleted)',
    example: 'active',
  })
  @Expose()
  status: 'active' | 'deleted';
}
