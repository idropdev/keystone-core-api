import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  SerializeOptions,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiOperation,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { AuthGoogleService } from './auth-google.service';
import { AuthGoogleLoginDto } from './dto/auth-google-login.dto';
import { LoginResponseDto } from '../auth/dto/login-response.dto';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller({
  path: 'auth/google',
  version: '1',
})
export class AuthGoogleController {
  constructor(
    private readonly authService: AuthService,
    private readonly authGoogleService: AuthGoogleService,
  ) {}

  @Post('login')
  @ApiOperation({
    summary: 'Google Sign-In Login',
    description:
      'Authenticate user with Google Sign-In ID token. Returns JWT access token, refresh token, and user information. ' +
      "If user doesn't exist, a new account will be created. Rate limited to 5 requests per minute.",
  })
  @ApiOkResponse({
    type: LoginResponseDto,
    description:
      'Login successful. Returns access token, refresh token, and user data.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or missing ID token',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired Google ID token',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Failed to verify Google ID token or create user',
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded. Maximum 5 login attempts per minute.',
  })
  @SerializeOptions({
    groups: ['me'],
  })
  @HttpCode(HttpStatus.OK)
  // HIPAA Security: Rate limiting on Google OAuth login (5 requests per 60 seconds)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() loginDto: AuthGoogleLoginDto): Promise<LoginResponseDto> {
    const socialData = await this.authGoogleService.getProfileByToken(loginDto);

    return this.authService.validateSocialLogin('google', socialData);
  }
}
