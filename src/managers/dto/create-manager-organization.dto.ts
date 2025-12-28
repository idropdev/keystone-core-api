import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateManagerOrganizationDto {
  @ApiProperty({
    example: 'Quest Diagnostics',
    description: 'Name of the manager organization',
  })
  @IsString()
  @IsNotEmpty()
  name: string;
}






