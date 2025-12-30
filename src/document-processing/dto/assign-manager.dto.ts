import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsNotEmpty } from 'class-validator';

export class AssignManagerDto {
  @ApiProperty({
    description: 'Manager ID to assign as origin manager for this document',
    example: 1,
    type: Number,
  })
  @IsNumber()
  @IsNotEmpty()
  managerId: number;
}

