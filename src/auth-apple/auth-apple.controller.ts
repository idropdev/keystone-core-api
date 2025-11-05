import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  SerializeOptions,
  Logger,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { AuthAppleService } from './auth-apple.service';
import { AuthAppleLoginDto } from './dto/auth-apple-login.dto';
import { AppleNotificationDto } from './dto/apple-notification.dto';
import { LoginResponseDto } from '../auth/dto/login-response.dto';
import { Throttle, SkipThrottle } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller({
  path: 'auth/apple',
  version: '1',
})
export class AuthAppleController {
  private readonly logger = new Logger(AuthAppleController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly authAppleService: AuthAppleService,
  ) {}

  @ApiOkResponse({
    type: LoginResponseDto,
  })
  @SerializeOptions({
    groups: ['me'],
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // HIPAA Security: Rate limiting on Apple OAuth login (5 requests per 60 seconds)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() loginDto: AuthAppleLoginDto): Promise<LoginResponseDto> {
    const socialData = await this.authAppleService.getProfileByToken(loginDto);

    return this.authService.validateSocialLogin('apple', socialData);
  }

  /**
   * Apple Server-to-Server Notifications Endpoint
   *
   * This endpoint receives notifications from Apple when users:
   * - Change email forwarding preferences (Hide My Email)
   * - Revoke consent for your app
   * - Delete their Apple account
   *
   * HIPAA Compliance:
   * - All events are logged for audit trail (NO PHI)
   * - User sessions invalidated when consent revoked
   * - Accounts soft-deleted (not hard-deleted) for audit retention
   * - JWS payload verified for authenticity
   *
   * Security:
   * - Must be HTTPS in production (TLS 1.2+)
   * - JWS signature verified using Apple's public keys
   * - Malformed requests rejected with 401
   * - No rate limiting (Apple is trusted caller)
   *
   * Configuration:
   * - Set this URL in Apple Developer Console
   * - Format: https://your-domain.com/api/v1/auth/apple/notifications
   * - Must be publicly accessible (Apple POSTs to this)
   *
   * @param notificationDto - JWS-signed notification from Apple
   */
  @ApiOperation({
    summary: 'Apple Server-to-Server Notifications',
    description:
      'Receives notifications from Apple about user account changes. ' +
      'Configure this endpoint URL in Apple Developer Console. ' +
      'HIPAA-compliant: All events logged, no PHI processed.',
  })
  @Post('notifications')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle() // Apple is trusted caller, no rate limiting needed
  async handleNotification(
    @Body() notificationDto: AppleNotificationDto,
  ): Promise<void> {
    // HIPAA Security: Log that we received a notification (NOT the payload)
    this.logger.log('Received Apple server-to-server notification');

    // Process the notification
    await this.authAppleService.handleNotification(notificationDto.payload);

    // Return 200 OK to Apple
    // No response body needed
  }
}
