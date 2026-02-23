import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class DocumentScopedChatDto {
  @ApiProperty({
    description:
      'Keystone document UUIDs to scope chat to. Use empty array or ["*"] for full-scope.',
    type: [String],
    example: ['2e6e9b1b-6c2c-4b4c-9e2b-9f1d5f3d9b1a'],
  })
  @IsArray()
  @IsString({ each: true })
  documentIds: string[];

  @ApiProperty({
    description: 'User message to send to the model.',
    example: 'Summarize my lab results and highlight anything abnormal.',
  })
  @IsString()
  message: string;

  @ApiPropertyOptional({
    description: 'Optional existing thread slug (if AnythingLLM supports it).',
    example: 'thread-abc',
  })
  @IsOptional()
  @IsString()
  threadSlug?: string;

  @ApiPropertyOptional({
    description: "Workspace slug to target in AnythingLLM (user's workspace).",
    example: 'user-123-workspace',
  })
  @IsOptional()
  @IsString()
  workspaceSlug?: string;
}
