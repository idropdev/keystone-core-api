import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentStatus } from '../domain/enums/document-status.enum';
import { DocumentType } from '../domain/enums/document-type.enum';

export class DocumentListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: DocumentStatus, isArray: true })
  @IsOptional()
  @IsEnum(DocumentStatus, { each: true })
  status?: DocumentStatus[];

  @ApiPropertyOptional({ enum: DocumentType, isArray: true })
  @IsOptional()
  @IsEnum(DocumentType, { each: true })
  documentType?: DocumentType[];
}
