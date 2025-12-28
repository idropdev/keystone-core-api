import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  MinLength,
  ValidateNested,
  IsOptional,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

class UserDataDto {
  @ApiProperty({ example: 'Quest' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Downtown' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @MinLength(6)
  password: string;
}

class LocationDto {
  @ApiPropertyOptional({ example: '123 Main St' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Austin' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'TX' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '78701' })
  @IsOptional()
  @IsString()
  zip?: string;
}

class IdentifiersDto {
  @ApiPropertyOptional({ example: '1234567890' })
  @IsOptional()
  @IsString()
  npi?: string;

  @ApiPropertyOptional({ example: '45D0987654' })
  @IsOptional()
  @IsString()
  clia?: string;
}

class ManagerProfileDto {
  @ApiPropertyOptional({ example: 'Quest Diagnostics - Downtown Lab' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ type: LocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @ApiPropertyOptional({ type: IdentifiersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IdentifiersDto)
  identifiers?: IdentifiersDto;
}

export class AcceptInvitationDto {
  @ApiProperty({
    example: 'invitation-token-here',
    description: 'One-time invitation token',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ type: UserDataDto })
  @ValidateNested()
  @Type(() => UserDataDto)
  user: UserDataDto;

  @ApiProperty({ type: ManagerProfileDto })
  @ValidateNested()
  @Type(() => ManagerProfileDto)
  managerProfile: ManagerProfileDto;
}






