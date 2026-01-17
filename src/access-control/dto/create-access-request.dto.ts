import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Create Access Request DTO
 *
 * SYSTEM-100: Access Request Workflow
 */
export class CreateAccessRequestDto {
  @ApiProperty({
    description: 'Document UUID to request access to',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  documentId: string;

  @ApiPropertyOptional({
    description: 'Reason for requesting access',
    example: 'Need to review for patient care coordination',
  })
  @IsOptional()
  @IsString()
  requestReason?: string;
}
