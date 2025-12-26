import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';

export class VerifyManagerDto {
  @ApiProperty({
    example: 'verified',
    enum: ['verified'],
    description: 'Verification status (must be "verified")',
  })
  @IsEnum(['verified'])
  @IsNotEmpty()
  status: 'verified';
}

