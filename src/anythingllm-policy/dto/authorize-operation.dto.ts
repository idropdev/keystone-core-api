import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AnythingLLMOperation } from '../domain/anythingllm-operation.enum';
import { ResourceContext } from '../domain/resource-context.entity';

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

export class AuthorizeOperationDto {
  @ApiProperty({ description: 'Requester context', type: RequesterContextDto })
  @ValidateNested()
  @Type(() => RequesterContextDto)
  requesterContext: RequesterContextDto;

  @ApiProperty({
    description: 'Operation to authorize',
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
  resourceContext?: ResourceContext;
}

export class AuthorizeOperationResponseDto {
  @ApiProperty({ description: 'Whether operation is allowed' })
  allowed: boolean;

  @ApiProperty({
    description: 'OAuth2 scopes granted',
    type: [String],
  })
  scope: string[];

  @ApiPropertyOptional({ description: 'Reason for denial (if not allowed)' })
  reason?: string;
}










