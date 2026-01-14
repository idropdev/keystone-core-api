import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM OpenAI-Compatible Schemas
 *
 * These schemas define the request/response shapes for OpenAI-compatible
 * endpoints in the AnythingLLM API.
 */

/**
 * Chat message for OpenAI-compatible endpoints
 */
export class OpenAIChatMessageSchema {
  @ApiProperty({ example: 'user' })
  @IsString()
  role: string;

  @ApiProperty({ example: 'What is AnythingLLM?' })
  @IsString()
  content: string;
}

/**
 * Request body for chat completions
 */
export class OpenAIChatCompletionsRequestSchema {
  @ApiProperty({ example: 'gpt-3.5-turbo' })
  @IsString()
  model: string;

  @ApiProperty({ type: [OpenAIChatMessageSchema] })
  @IsArray()
  messages: OpenAIChatMessageSchema[];

  @ApiPropertyOptional({ example: 0.7 })
  @IsOptional()
  @IsNumber()
  temperature?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @IsNumber()
  max_tokens?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

/**
 * Choice object in chat completions response
 */
export class OpenAIChatChoiceSchema {
  @ApiProperty()
  @IsNumber()
  index: number;

  @ApiProperty({ type: OpenAIChatMessageSchema })
  message: OpenAIChatMessageSchema;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  finish_reason?: string;
}

/**
 * Response for chat completions endpoint
 */
export class OpenAIChatCompletionsResponseSchema {
  @ApiProperty({ example: 'chatcmpl-123' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'chat.completion' })
  @IsString()
  object: string;

  @ApiProperty({ example: 1692851630 })
  @IsNumber()
  created: number;

  @ApiProperty({ example: 'gpt-3.5-turbo' })
  @IsString()
  model: string;

  @ApiProperty({ type: [OpenAIChatChoiceSchema] })
  @IsArray()
  choices: OpenAIChatChoiceSchema[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Request body for embeddings
 */
export class OpenAIEmbeddingsRequestSchema {
  @ApiProperty({ example: 'text-embedding-ada-002' })
  @IsString()
  model: string;

  @ApiProperty({ example: 'The text to embed' })
  @IsString()
  input: string | string[];
}

/**
 * Embedding object in embeddings response
 */
export class OpenAIEmbeddingSchema {
  @ApiProperty({ example: 0 })
  @IsNumber()
  index: number;

  @ApiProperty({ example: [0.1, 0.2, 0.3], type: [Number] })
  @IsArray()
  @IsNumber({}, { each: true })
  embedding: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  object?: string;
}

/**
 * Response for embeddings endpoint
 */
export class OpenAIEmbeddingsResponseSchema {
  @ApiProperty({ example: 'list' })
  @IsString()
  object: string;

  @ApiProperty({ type: [OpenAIEmbeddingSchema] })
  @IsArray()
  data: OpenAIEmbeddingSchema[];

  @ApiProperty({ example: 'text-embedding-ada-002' })
  @IsString()
  model: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
