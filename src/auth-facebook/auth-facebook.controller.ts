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
} from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { AuthFacebookService } from './auth-facebook.service';
import { AuthFacebookLoginDto } from './dto/auth-facebook-login.dto';
import { LoginResponseDto } from '../auth/dto/login-response.dto';

@ApiTags('Auth')
@Controller({
  path: 'auth/facebook',
  version: '1',
})
export class AuthFacebookController {
  constructor(
    private readonly authService: AuthService,
    private readonly authFacebookService: AuthFacebookService,
  ) {}

  @Post('login')
  @ApiOperation({
    summary: 'Facebook Login',
    description:
      'Authenticate user with Facebook access token. Returns JWT access token, refresh token, and user information. ' +
      "If user doesn't exist, a new account will be created.",
  })
  @ApiOkResponse({
    type: LoginResponseDto,
    description:
      'Login successful. Returns access token, refresh token, and user data.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or missing access token',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired Facebook access token',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Failed to verify Facebook token or create user',
  })
  @SerializeOptions({
    groups: ['me'],
  })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: AuthFacebookLoginDto,
  ): Promise<LoginResponseDto> {
    const socialData =
      await this.authFacebookService.getProfileByToken(loginDto);

    return this.authService.validateSocialLogin('facebook', socialData);
  }
}
