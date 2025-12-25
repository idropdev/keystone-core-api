import { IsNumber, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateUserManagerAssignmentDto {
  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @IsNumber()
  @IsNotEmpty()
  managerId: number;

  @IsNumber()
  @IsOptional()
  assignedById?: number;
}

