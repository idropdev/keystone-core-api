import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateManagerProfileDto {
  @ApiPropertyOptional({
    example: 'Quest Diagnostics – Downtown Lab',
    description: 'Display name for the manager instance',
  })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({
    example: '+1-555-0123',
    description: 'Contact phone number',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: 'Mon–Fri 8am–5pm',
    description: 'Operating hours',
  })
  @IsOptional()
  @IsString()
  operatingHours?: string;
}

