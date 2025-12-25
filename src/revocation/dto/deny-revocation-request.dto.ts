import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DenyRevocationRequestDto {
  @ApiPropertyOptional({
    description: 'Optional review notes from origin manager explaining denial',
    example: 'Access still required for ongoing care',
    maxLength: 1000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reviewNotes?: string;
}

