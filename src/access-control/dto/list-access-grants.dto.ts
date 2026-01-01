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

export class ListAccessGrantsDto {
  @ApiPropertyOptional({
    description: 'Filter by document ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsOptional()
  documentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by subject type',
    enum: ['user', 'manager'],
    example: 'user',
  })
  @IsEnum(['user', 'manager'])
  @IsOptional()
  subjectType?: 'user' | 'manager';

  @ApiPropertyOptional({
    description: 'Filter by subject ID',
    example: 123,
  })
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  subjectId?: number;

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
