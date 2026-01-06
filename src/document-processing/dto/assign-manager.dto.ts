import { IsNumber, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignManagerDto {
  @ApiProperty({
    description: 'Manager ID to assign as origin manager',
    example: 1,
    type: Number,
  })
  @IsNumber()
  @IsNotEmpty()
  managerId: number;
}

