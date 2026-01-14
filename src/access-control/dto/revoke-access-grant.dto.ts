import { IsEnum, IsNotEmpty, IsNumber } from 'class-validator';

export class RevokeAccessGrantDto {
  @IsNumber()
  @IsNotEmpty()
  grantId: number;

  @IsEnum(['user', 'manager'])
  @IsNotEmpty()
  revokedByType: 'user' | 'manager';

  @IsNumber()
  @IsNotEmpty()
  revokedById: number;
}
