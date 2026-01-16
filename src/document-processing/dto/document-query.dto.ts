import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  Max,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Queryable document fields
 */
export const QUERYABLE_FIELDS = [
  'id',
  'status',
  'documentType',
  'fileName',
  'mimeType',
  'fileSize',
  'pageCount',
  'confidence',
  'uploadedAt',
  'processedAt',
  'createdAt',
] as const;

export type QueryableField = (typeof QUERYABLE_FIELDS)[number];

/**
 * Query operators supported by the document query endpoint
 */
export enum QueryOperator {
  EQ = 'eq',
  NE = 'ne',
  GT = 'gt',
  GTE = 'gte',
  LT = 'lt',
  LTE = 'lte',
  CONTAINS = 'contains',
  STARTS_WITH = 'startsWith',
  ENDS_WITH = 'endsWith',
  IN = 'in',
  BETWEEN = 'between',
}

/**
 * Sort order
 */
export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/**
 * Field filter DTO
 */
export class FieldFilterDto {
  @ApiProperty({
    description: 'Field name to filter on',
    example: 'status',
  })
  @IsString()
  field: string;

  @ApiProperty({
    description: 'Query operator',
    enum: QueryOperator,
    example: QueryOperator.EQ,
  })
  @IsEnum(QueryOperator)
  op: QueryOperator;

  @ApiProperty({
    description: 'Filter value (type depends on field and operator)',
    example: 'PROCESSED',
  })
  value: string | number | string[] | number[] | Date | [Date, Date];
}

/**
 * Extracted field filter DTO
 */
export class ExtractedFieldFilterDto {
  @ApiProperty({
    description: 'Extracted field key (e.g., "patientName", "labType")',
    example: 'patientName',
  })
  @IsString()
  key: string;

  @ApiProperty({
    description: 'Query operator for field value',
    enum: QueryOperator,
    example: QueryOperator.CONTAINS,
  })
  @IsEnum(QueryOperator)
  op: QueryOperator;

  @ApiProperty({
    description: 'Filter value for extracted field',
    example: 'Smith',
  })
  @IsString()
  value: string | number | string[] | number[];
}

/**
 * Boolean query DTO (AND/OR combinators)
 */
export class BooleanQueryDto {
  @ApiPropertyOptional({
    description: 'AND conditions (all must match)',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  and?: (FieldFilterDto | ExtractedFieldFilterDto | BooleanQueryDto)[];

  @ApiPropertyOptional({
    description: 'OR conditions (at least one must match)',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  or?: (FieldFilterDto | ExtractedFieldFilterDto | BooleanQueryDto)[];
}

/**
 * Sort DTO
 */
export class SortDto {
  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'uploadedAt',
    default: 'uploadedAt',
  })
  @IsOptional()
  @IsString()
  field?: string = 'uploadedAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: SortOrder,
    example: SortOrder.DESC,
    default: SortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.DESC;
}

/**
 * Pagination DTO
 */
export class PaginationDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
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
    description: 'Items per page',
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/**
 * Document query request DTO
 */
export class DocumentQueryDto {
  @ApiPropertyOptional({
    description:
      'Query filters (field filters, boolean combinators, extracted field filters)',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BooleanQueryDto)
  query?: BooleanQueryDto | FieldFilterDto | ExtractedFieldFilterDto;

  @ApiPropertyOptional({
    description:
      'Full-text search query (searches fileName, description, extractedText)',
    example: 'glucose levels high',
  })
  @IsOptional()
  @IsString()
  fullText?: string;

  @ApiPropertyOptional({
    description: 'Pagination options',
    type: PaginationDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaginationDto)
  pagination?: PaginationDto;

  @ApiPropertyOptional({
    description: 'Sort options',
    type: SortDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SortDto)
  sort?: SortDto;
}
