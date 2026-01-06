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

  // These fields are populated from the authenticated user context, not from the request
  // They are optional in the DTO but will be set from the actor in the service layer
  @IsEnum(['user', 'manager'])
  grantedByType?: 'user' | 'manager';

  @IsNumber()
  grantedById?: number;
}
