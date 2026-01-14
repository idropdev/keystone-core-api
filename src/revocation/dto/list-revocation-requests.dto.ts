import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListRevocationRequestsDto {
  @ApiPropertyOptional({
    description: 'Filter by document ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsOptional()
  documentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by status',
    enum: ['pending', 'approved', 'denied', 'cancelled'],
    example: 'pending',
  })
  @IsEnum(['pending', 'approved', 'denied', 'cancelled'])
  @IsOptional()
  status?: 'pending' | 'approved' | 'denied' | 'cancelled';

  @ApiPropertyOptional({
    description: 'Filter by request type',
    enum: ['self_revocation', 'user_revocation', 'manager_revocation'],
    example: 'self_revocation',
  })
  @IsEnum(['self_revocation', 'user_revocation', 'manager_revocation'])
  @IsOptional()
  requestType?: 'self_revocation' | 'user_revocation' | 'manager_revocation';

  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    example: 1,
    default: 1,
    minimum: 1,
  })
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({
    description: 'Items per page',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}
