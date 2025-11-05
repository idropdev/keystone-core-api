/**
 * Apple Server-to-Server Notification Payload Structure
 *
 * After JWS verification, the payload contains nested JSON with event details.
 *
 * Reference: https://developer.apple.com/documentation/sign_in_with_apple/processing_changes_for_sign_in_with_apple_accounts
 */

export interface AppleNotificationPayload {
  iss: string; // Issuer (should be https://appleid.apple.com)
  aud: string; // Audience (your client ID)
  iat: number; // Issued at timestamp
  jti: string; // JWT ID (unique identifier)
  events: string; // JSON string containing the actual event
}

export interface AppleEventData {
  type:
    | 'email-disabled'
    | 'email-enabled'
    | 'consent-revoked'
    | 'account-delete';
  sub: string; // Apple user ID
  email?: string; // User's email (may be private relay)
  is_private_email?: boolean; // Whether using Hide My Email
  event_time: number; // Unix timestamp
}
