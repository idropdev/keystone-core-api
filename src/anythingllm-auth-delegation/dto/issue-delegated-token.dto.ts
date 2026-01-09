import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsArray, IsNotEmpty, IsOptional } from 'class-validator';

export class RequesterContextDto {
  @ApiProperty({ description: 'Requester user ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Requester roles', type: [String] })
  @IsArray()
  @IsString({ each: true })
  roles: string[];

  @ApiPropertyOptional({ description: 'Session ID for audit' })
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Auth provider' })
  @IsString()
  @IsOptional()
  provider?: string;
}

export class IssueDelegatedTokenDto {
  @ApiProperty({ description: 'Requester context', type: RequesterContextDto })
  @IsNotEmpty()
  requesterContext: RequesterContextDto;

  @ApiProperty({ description: 'Operation identifier', example: 'THREAD_CHAT' })
  @IsString()
  @IsNotEmpty()
  operation: string;

  @ApiProperty({
    description: 'OAuth2 scopes',
    type: [String],
    example: ['anythingllm:thread:chat'],
  })
  @IsArray()
  @IsString({ each: true })
  scope: string[];
}
