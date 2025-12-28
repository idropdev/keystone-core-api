import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsString, IsNumber, IsBoolean, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthEventType } from '../audit.service';

export class ListAuditEventsDto {
  @ApiPropertyOptional({
    description: 'Filter by event type',
    enum: AuthEventType,
    example: AuthEventType.DOCUMENT_VIEWED,
  })
  @IsOptional()
  @IsEnum(AuthEventType)
  eventType?: AuthEventType;

  @ApiPropertyOptional({
    description: 'Filter by document UUID',
    type: String,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsString()
  documentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by actor type',
    enum: ['user', 'manager', 'admin', 'system'],
    example: 'user',
  })
  @IsOptional()
  @IsEnum(['user', 'manager', 'admin', 'system'])
  actorType?: 'user' | 'manager' | 'admin' | 'system';

  @ApiPropertyOptional({
    description: 'Filter by actor ID',
    type: Number,
    example: 123,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  actorId?: number;

  @ApiPropertyOptional({
    description: 'Filter by origin manager ID',
    type: Number,
    example: 456,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  originManagerId?: number;

  @ApiPropertyOptional({
    description: 'Start date (ISO 8601)',
    type: String,
    example: '2025-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'End date (ISO 8601)',
    type: String,
    example: '2025-01-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by success status',
    type: Boolean,
    example: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  success?: boolean;

  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    type: Number,
    minimum: 1,
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page (max 1000)',
    type: Number,
    minimum: 1,
    maximum: 1000,
    default: 100,
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 100;
}






