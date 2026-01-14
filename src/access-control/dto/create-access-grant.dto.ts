import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUUID,
} from 'class-validator';

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
  // @IsOptional() ensures validation is skipped when these fields are not provided
  @IsOptional()
  @IsEnum(['user', 'manager'])
  grantedByType?: 'user' | 'manager';

  @IsOptional()
  @IsNumber()
  grantedById?: number;
}
