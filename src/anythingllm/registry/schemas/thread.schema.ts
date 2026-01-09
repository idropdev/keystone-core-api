import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  IsObject,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * AnythingLLM Thread Schemas
 *
 * These schemas define the request/response shapes for thread management
 * endpoints in the AnythingLLM API.
 */

/**
 * Attachment object for chat messages
 */
export class ChatAttachmentSchema {
  @ApiProperty({ example: 'image.png' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  mime: string;

  @ApiProperty({ example: 'data:image/png;base64,iVBORw0KGgo...' })
  @IsString()
  contentString: string;
}

/**
 * Request body for creating a thread
 */
export class CreateThreadRequestSchema {
  @ApiPropertyOptional({ example: 'My Thread' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'my-thread' })
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  userId?: number;
}

/**
 * Request body for updating a thread
 */
export class UpdateThreadRequestSchema {
  @ApiProperty({ example: 'Updated Thread Name' })
  @IsString()
  name: string;
}

/**
 * Request body for sending a chat message
 */
export class ThreadChatRequestSchema {
  @ApiProperty({ example: 'What is AnythingLLM?' })
  @IsString()
  message: string;

  @ApiProperty({ example: 'query', enum: ['query', 'chat'] })
  @IsEnum(['query', 'chat'])
  mode: 'query' | 'chat';

  @ApiProperty({ example: 1 })
  @IsNumber()
  userId: number;

  @ApiPropertyOptional({ type: [ChatAttachmentSchema] })
  @IsOptional()
  @IsArray()
  attachments?: ChatAttachmentSchema[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  reset?: boolean;
}

/**
 * Source object in chat response
 */
export class ChatSourceSchema {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  chunk: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Chat message object
 */
export class ChatMessageSchema {
  @ApiProperty({ example: 'user' })
  @IsString()
  role: string;

  @ApiProperty({ example: 'What is AnythingLLM?' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ example: 1692851630 })
  @IsOptional()
  @IsNumber()
  sentAt?: number;

  @ApiPropertyOptional({ type: [ChatSourceSchema] })
  @IsOptional()
  @IsArray()
  sources?: ChatSourceSchema[];
}

/**
 * Response for create thread endpoint
 */
export class CreateThreadResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  threadSlug?: string;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for update thread endpoint
 */
export class UpdateThreadResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for delete thread endpoint
 */
export class DeleteThreadResponseSchema {
  @ApiProperty({ example: true })
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response for get thread chats endpoint
 */
export class ThreadChatsResponseSchema {
  @ApiProperty({ type: [ChatMessageSchema] })
  @IsArray()
  history: ChatMessageSchema[];
}

/**
 * Response for thread chat endpoint (non-streaming)
 */
export class ThreadChatResponseSchema {
  @ApiProperty({ example: 'chat-uuid' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'textResponse', enum: ['abort', 'textResponse'] })
  @IsEnum(['abort', 'textResponse'])
  type: 'abort' | 'textResponse';

  @ApiPropertyOptional({ example: 'Response to your query' })
  @IsOptional()
  @IsString()
  textResponse?: string;

  @ApiPropertyOptional({ type: [ChatSourceSchema] })
  @IsOptional()
  @IsArray()
  sources?: ChatSourceSchema[];

  @ApiProperty({ example: true })
  @IsBoolean()
  close: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}

/**
 * Response chunk for stream chat endpoint
 */
export class ThreadStreamChatChunkSchema {
  @ApiProperty({ example: 'uuid-123' })
  @IsString()
  id: string;

  @ApiProperty({
    example: 'textResponseChunk',
    enum: ['abort', 'textResponseChunk'],
  })
  @IsEnum(['abort', 'textResponseChunk'])
  type: 'abort' | 'textResponseChunk';

  @ApiPropertyOptional({ example: 'First chunk' })
  @IsOptional()
  @IsString()
  textResponse?: string;

  @ApiPropertyOptional({ type: [ChatSourceSchema] })
  @IsOptional()
  @IsArray()
  sources?: ChatSourceSchema[];

  @ApiProperty({ example: false })
  @IsBoolean()
  close: boolean;

  @ApiPropertyOptional({ example: null })
  @IsOptional()
  error?: string | null;
}
