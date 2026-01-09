import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { ResourceContext } from '../../anythingllm-policy/domain/resource-context.entity';

export class RequesterContextDto {
  @ApiProperty({ description: 'Requester user ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Requester roles', type: [String] })
  roles: string[];

  @ApiPropertyOptional({ description: 'Session ID' })
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Auth provider' })
  @IsString()
  @IsOptional()
  provider?: string;
}

export class CallAnythingLLMDto {
  @ApiProperty({ description: 'Requester context', type: RequesterContextDto })
  @ValidateNested()
  @Type(() => RequesterContextDto)
  requesterContext: RequesterContextDto;

  @ApiProperty({
    description: 'Operation identifier',
    enum: AnythingLLMOperation,
  })
  @IsString()
  @IsNotEmpty()
  operation: AnythingLLMOperation;

  @ApiPropertyOptional({
    description: 'Resource context',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  resourceContext?: ResourceContext;

  @ApiProperty({
    description: 'HTTP endpoint',
    example: '/v1/workspace/{slug}/thread/{slug}/chat',
  })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({ description: 'HTTP method', example: 'POST' })
  @IsString()
  @IsNotEmpty()
  method: string;

  @ApiPropertyOptional({ description: 'HTTP request body' })
  @IsOptional()
  body?: unknown;

  @ApiPropertyOptional({ description: 'HTTP request headers', type: Object })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}
