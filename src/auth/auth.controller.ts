import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Request,
  Post,
  UseGuards,
  Patch,
  Delete,
  SerializeOptions,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiOperation,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiUnprocessableEntityResponse,
  ApiTooManyRequestsResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { AuthEmailLoginDto } from './dto/auth-email-login.dto';
import { AuthForgotPasswordDto } from './dto/auth-forgot-password.dto';
import { AuthConfirmEmailDto } from './dto/auth-confirm-email.dto';
import { AuthResetPasswordDto } from './dto/auth-reset-password.dto';
import { AuthUpdateDto } from './dto/auth-update.dto';
import { AuthGuard } from '@nestjs/passport';
import { AuthRegisterLoginDto } from './dto/auth-register-login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { NullableType } from '../utils/types/nullable.type';
import { User } from '../users/domain/user';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { Throttle } from '@nestjs/throttler';
import { ServiceApiKeyGuard } from './guards/service-api-key.guard';
import {
  TokenIntrospectDto,
  TokenIntrospectResponseDto,
} from './dto/token-introspect.dto';

@ApiTags('Auth')
@Controller({
  path: 'auth',
  version: '1',
})
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @SerializeOptions({
    groups: ['me'],
  })
  @Post('email/login')
  @ApiOperation({
    summary: 'Email/Password Login',
    description:
      'Authenticate user with email and password. Returns JWT access token, refresh token, and user information. Rate limited to 5 requests per minute.',
  })
  @ApiOkResponse({
    type: LoginResponseDto,
    description:
      'Login successful. Returns access token, refresh token, and user data.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or validation errors',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Invalid credentials, user not found, or wrong authentication provider',
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded. Maximum 5 login attempts per minute.',
  })
  @HttpCode(HttpStatus.OK)
  // HIPAA Security: Strict rate limiting on login endpoint (5 requests per 60 seconds)
  // TODO: Consider implementing progressive delays after failed attempts
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  public login(@Body() loginDto: AuthEmailLoginDto): Promise<LoginResponseDto> {
    return this.service.validateLogin(loginDto);
  }

  @Post('email/register')
  @ApiOperation({
    summary: 'Email Registration',
    description:
      'Register a new user account with email and password. A confirmation email will be sent. Rate limited to 5 requests per minute.',
  })
  @ApiNoContentResponse({
    description: 'Registration successful. Confirmation email sent.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or validation errors',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Email already exists or invalid data',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded. Maximum 5 registration attempts per minute.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  // HIPAA Security: Rate limiting on registration (5 requests per 60 seconds)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() createUserDto: AuthRegisterLoginDto): Promise<void> {
    return this.service.register(createUserDto);
  }

  @Post('email/confirm')
  @ApiOperation({
    summary: 'Confirm Email Address',
    description:
      'Confirm email address using the hash token sent via email. Activates the user account.',
  })
  @ApiNoContentResponse({
    description: 'Email confirmed successfully. Account activated.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired confirmation hash',
  })
  @ApiNotFoundResponse({
    description: 'User not found or already confirmed',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmEmail(
    @Body() confirmEmailDto: AuthConfirmEmailDto,
  ): Promise<void> {
    return this.service.confirmEmail(confirmEmailDto.hash);
  }

  @Post('email/confirm/new')
  @ApiOperation({
    summary: 'Confirm New Email Address',
    description:
      'Confirm a new email address after email change. Uses the hash token sent to the new email address.',
  })
  @ApiNoContentResponse({
    description: 'New email confirmed successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired confirmation hash',
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async confirmNewEmail(
    @Body() confirmEmailDto: AuthConfirmEmailDto,
  ): Promise<void> {
    return this.service.confirmNewEmail(confirmEmailDto.hash);
  }

  @Post('forgot/password')
  @ApiOperation({
    summary: 'Request Password Reset',
    description:
      'Request a password reset email. A reset link will be sent to the provided email address. Rate limited to 3 requests per minute.',
  })
  @ApiNoContentResponse({
    description: 'Password reset email sent (if email exists).',
  })
  @ApiBadRequestResponse({
    description: 'Invalid email format',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Email not found in system',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded. Maximum 3 password reset requests per minute.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  // HIPAA Security: Rate limiting on password reset (3 requests per 60 seconds)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async forgotPassword(
    @Body() forgotPasswordDto: AuthForgotPasswordDto,
  ): Promise<void> {
    return this.service.forgotPassword(forgotPasswordDto.email);
  }

  @Post('reset/password')
  @ApiOperation({
    summary: 'Reset Password',
    description:
      'Reset password using the hash token from the password reset email. All user sessions will be invalidated except the current one.',
  })
  @ApiNoContentResponse({
    description: 'Password reset successfully. All sessions invalidated.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired reset hash',
  })
  @ApiUnprocessableEntityResponse({
    description: 'User not found or invalid password',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() resetPasswordDto: AuthResetPasswordDto): Promise<void> {
    return this.service.resetPassword(
      resetPasswordDto.hash,
      resetPasswordDto.password,
    );
  }

  @ApiBearerAuth()
  @SerializeOptions({
    groups: ['me'],
  })
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Get Current User',
    description:
      "Get the authenticated user's profile information. Requires valid JWT access token.",
  })
  @ApiOkResponse({
    type: User,
    description: 'User profile information',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @HttpCode(HttpStatus.OK)
  public me(@Request() request): Promise<NullableType<User>> {
    return this.service.me(request.user);
  }

  @ApiBearerAuth()
  @ApiOkResponse({
    type: RefreshResponseDto,
    description: 'New access token and refresh token issued',
  })
  @SerializeOptions({
    groups: ['me'],
  })
  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiOperation({
    summary: 'Refresh Access Token',
    description:
      'Refresh the access token using a valid refresh token. Returns new access token, refresh token, and expiration time. Rate limited to 10 requests per minute.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired refresh token, or session revoked',
  })
  @ApiTooManyRequestsResponse({
    description: 'Rate limit exceeded. Maximum 10 refresh requests per minute.',
  })
  @HttpCode(HttpStatus.OK)
  // HIPAA Security: Rate limiting on token refresh (10 requests per 60 seconds)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  public refresh(@Request() request): Promise<RefreshResponseDto> {
    return this.service.refreshToken({
      sessionId: request.user.sessionId,
      hash: request.user.hash,
    });
  }

  @ApiBearerAuth()
  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Logout',
    description:
      'Logout the current user and invalidate the session. The access token will no longer be valid.',
  })
  @ApiNoContentResponse({
    description: 'Logout successful. Session invalidated.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(@Request() request): Promise<void> {
    await this.service.logout({
      sessionId: request.user.sessionId,
    });
  }

  @ApiBearerAuth()
  @SerializeOptions({
    groups: ['me'],
  })
  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Update Current User Profile',
    description:
      "Update the authenticated user's profile information. If password is changed, all other sessions will be invalidated. If email is changed, a confirmation email will be sent.",
  })
  @ApiOkResponse({
    type: User,
    description: 'Updated user profile',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or validation errors',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Email already exists, incorrect old password, or user not found',
  })
  @HttpCode(HttpStatus.OK)
  public update(
    @Request() request,
    @Body() userDto: AuthUpdateDto,
  ): Promise<NullableType<User>> {
    return this.service.update(request.user, userDto);
  }

  @ApiBearerAuth()
  @Delete('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Delete Current User Account',
    description:
      "Soft delete the authenticated user's account. The account will be marked as deleted but data will be retained for audit purposes.",
  })
  @ApiNoContentResponse({
    description: 'Account deleted successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  public async delete(@Request() request): Promise<void> {
    return this.service.softDelete(request.user);
  }

  /**
   * Token introspection endpoint (RFC 7662: OAuth 2.0 Token Introspection)
   *
   * HIPAA Compliance:
   * - Service-to-service authentication required (API key)
   * - Rate limited to prevent abuse
   * - All introspection events are audit logged
   * - No PHI in requests/responses
   */
  @Post('introspect')
  @UseGuards(ServiceApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Token Introspection (RFC 7662)',
    description:
      'Introspect a JWT access token to determine if it is active and get token metadata. ' +
      'This endpoint is for service-to-service communication (e.g., AnythingLLM integration). ' +
      'Requires service API key authentication. Rate limited to 100 requests per minute. ' +
      'HIPAA compliant: No PHI in requests/responses, all events audit logged.',
  })
  @ApiOkResponse({
    type: TokenIntrospectResponseDto,
    description: 'RFC 7662 compliant token introspection response',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or missing token',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid service API key',
  })
  @ApiTooManyRequestsResponse({
    description:
      'Rate limit exceeded. Maximum 100 introspection requests per minute.',
  })
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 requests per minute
  public async introspect(
    @Body() dto: TokenIntrospectDto,
    @Request() request,
  ): Promise<TokenIntrospectResponseDto> {
    // Extract client service identifier from request (optional, for audit logging)
    const clientService = request.headers['x-client-service'] || 'unknown';

    return this.service.introspectToken(dto, clientService);
  }
}
