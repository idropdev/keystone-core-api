import { IsEnum, IsNotEmpty, IsNumber, IsUUID } from 'class-validator';

export class CreateAccessGrantDto {
  @IsUUID()
  @IsNotEmpty()
  documentId: string;

  @IsEnum(['user', 'manager'])
  @IsNotEmpty()
  subjectType: 'user' | 'manager';

  @IsNumber()
  @IsNotEmpty()
  subjectId: number;

  @IsEnum(['owner', 'delegated', 'derived'])
  @IsNotEmpty()
  grantType: 'owner' | 'delegated' | 'derived';

  @IsEnum(['user', 'manager'])
  @IsNotEmpty()
  grantedByType: 'user' | 'manager';

  @IsNumber()
  @IsNotEmpty()
  grantedById: number;
}
