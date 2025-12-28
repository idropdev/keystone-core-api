import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SuspendManagerDto {
  @ApiProperty({
    example: 'Compliance review',
    description: 'Reason for suspension',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}






