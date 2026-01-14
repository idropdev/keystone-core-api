import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/domain/user';

/**
 * Response DTO for user registration
 *
 * Returns the created user object after successful registration.
 * The user is in 'inactive' status until email confirmation.
 */
export class AuthRegisterResponseDto {
  @ApiProperty({
    type: () => User,
    description: 'The newly created user object',
  })
  user: User;
}
