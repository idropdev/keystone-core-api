import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApproveRevocationRequestDto {
  @ApiPropertyOptional({
    description: 'Optional review notes from origin manager',
    example: 'Access revoked per user request',
    maxLength: 1000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reviewNotes?: string;
}

