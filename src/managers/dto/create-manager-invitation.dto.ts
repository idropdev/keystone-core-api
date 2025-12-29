import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  ValidateIf,
} from 'class-validator';

export class CreateManagerInvitationDto {
  @ApiProperty({
    example: 'downtown@quest.com',
    description: 'Email address of the manager to invite',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: 'Quest Diagnostics – Downtown Lab',
    description: 'Display name for the manager (required)',
  })
  @IsString()
  @IsNotEmpty()
  displayName: string;

  @ApiProperty({
    example: 'Quest Diagnostics Incorporated',
    description: 'Legal name for the manager (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  legalName?: string;

  @ApiProperty({
    example: '123 Main St, Austin, TX 78701',
    description: 'Full address (required if latitude/longitude not provided)',
    required: false,
  })
  @IsString()
  @IsOptional()
  @ValidateIf((o) => !o.latitude || !o.longitude)
  @IsNotEmpty()
  address?: string;

  @ApiProperty({
    example: 30.2672,
    description:
      'Latitude (required if address not provided, must provide both lat and long)',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  @ValidateIf((o) => !o.address)
  @IsNotEmpty()
  latitude?: number;

  @ApiProperty({
    example: -97.7431,
    description:
      'Longitude (required if address not provided, must provide both lat and long)',
    required: false,
  })
  @IsNumber()
  @IsOptional()
  @ValidateIf((o) => !o.address)
  @IsNotEmpty()
  longitude?: number;

  @ApiProperty({
    example: '+1-512-555-1234',
    description: 'Phone number (optional)',
    required: false,
  })
  @IsString()
  @IsOptional()
  phoneNumber?: string;
}
