import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Apple Server-to-Server Notification DTO
 *
 * Apple sends notifications as JWS (JSON Web Signature) payloads
 * when users make changes to their Apple ID or Sign in with Apple settings.
 *
 * HIPAA Compliance:
 * - Only identity events are processed (no PHI)
 * - All events are logged for audit trails
 * - Payload is verified using Apple's public keys
 *
 * Event Types:
 * - email-disabled: User stopped using Hide My Email
 * - email-enabled: User started using Hide My Email
 * - consent-revoked: User stopped using Sign in with Apple
 * - account-delete: User deleted their Apple account
 *
 * Reference: https://developer.apple.com/documentation/sign_in_with_apple/processing_changes_for_sign_in_with_apple_accounts
 */
export class AppleNotificationDto {
  @ApiProperty({
    description: 'JWS-signed notification payload from Apple',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IldYRzg...',
  })
  @IsNotEmpty()
  @IsString()
  payload: string;
}

/**
 * Internal representation of Apple notification event
 * (after JWS verification and decoding)
 */
export interface AppleNotificationEvent {
  type:
    | 'email-disabled'
    | 'email-enabled'
    | 'consent-revoked'
    | 'account-delete';
  sub: string; // Apple user ID (socialId in our DB)
  email?: string; // May be null or Apple private relay
  is_private_email?: boolean; // True if using Hide My Email
  event_time: number; // Unix timestamp
}
