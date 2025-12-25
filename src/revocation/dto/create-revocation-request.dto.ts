import { IsEnum, IsNotEmpty, IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRevocationRequestDto {
  @ApiProperty({
    description: 'Document ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  documentId: string;

  @ApiProperty({
    description: 'Type of revocation request',
    enum: ['self_revocation', 'user_revocation', 'manager_revocation'],
    example: 'self_revocation',
  })
  @IsEnum(['self_revocation', 'user_revocation', 'manager_revocation'])
  @IsNotEmpty()
  requestType: 'self_revocation' | 'user_revocation' | 'manager_revocation';

  @ApiPropertyOptional({
    description: 'If true, revoke secondary manager grants when approved',
    default: false,
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  cascadeToSecondaryManagers?: boolean;
}

