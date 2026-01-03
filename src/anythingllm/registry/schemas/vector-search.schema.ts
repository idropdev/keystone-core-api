import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM Vector Search Schemas
 *
 * These schemas define the request/response shapes for vector search
 * endpoints in the AnythingLLM API.
 */

/**
 * Vector search result chunk
 */
export class VectorSearchChunkSchema {
  @ApiProperty()
  @IsString()
  text: string;

  @ApiProperty()
  @IsString()
  source: string;

  @ApiProperty()
  @IsNumber()
  score: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Request body for vector search
 */
export class VectorSearchRequestSchema {
  @ApiProperty({ example: 'What is AnythingLLM?' })
  @IsString()
  query: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  topN?: number;

  @ApiPropertyOptional({ example: 0.7 })
  @IsOptional()
  @IsNumber()
  scoreThreshold?: number;

  @ApiPropertyOptional({ example: ['doc1.json', 'doc2.json'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  docPaths?: string[];
}

/**
 * Response for vector search endpoint
 */
export class VectorSearchResponseSchema {
  @ApiProperty({ type: [VectorSearchChunkSchema] })
  @IsArray()
  results: VectorSearchChunkSchema[];
}



