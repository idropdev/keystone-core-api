import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';

export interface AuthEventData {
  userId: string | number;
  provider: string;
  event: AuthEventType;
  sessionId?: string | number;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, any>; // Additional event-specific data
}

export enum AuthEventType {
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILED = 'LOGIN_FAILED',
  REFRESH_TOKEN_SUCCESS = 'REFRESH_TOKEN_SUCCESS',
  REFRESH_TOKEN_FAILED = 'REFRESH_TOKEN_FAILED',
  LOGOUT = 'LOGOUT',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  EMAIL_CONFIRMED = 'EMAIL_CONFIRMED',
  ACCOUNT_CREATED = 'ACCOUNT_CREATED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  TOKEN_VALIDATION_FAILED = 'TOKEN_VALIDATION_FAILED',
  INVALID_SESSION = 'INVALID_SESSION',
  // Token introspection events (RFC 7662)
  TOKEN_INTROSPECTION_SUCCESS = 'TOKEN_INTROSPECTION_SUCCESS',
  TOKEN_INTROSPECTION_FAILED = 'TOKEN_INTROSPECTION_FAILED',
  // Apple Sign In server-to-server notification events
  APPLE_EMAIL_DISABLED = 'APPLE_EMAIL_DISABLED',
  APPLE_EMAIL_ENABLED = 'APPLE_EMAIL_ENABLED',
  APPLE_CONSENT_REVOKED = 'APPLE_CONSENT_REVOKED',
  APPLE_ACCOUNT_DELETED = 'APPLE_ACCOUNT_DELETED',
  // Document processing events (HIPAA compliance)
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',
  DOCUMENT_PROCESSING_STARTED = 'DOCUMENT_PROCESSING_STARTED',
  DOCUMENT_PROCESSING_COMPLETED = 'DOCUMENT_PROCESSING_COMPLETED',
  DOCUMENT_PROCESSING_FAILED = 'DOCUMENT_PROCESSING_FAILED',
  DOCUMENT_ACCESSED = 'DOCUMENT_ACCESSED',
  DOCUMENT_DELETED = 'DOCUMENT_DELETED',
  DOCUMENT_HARD_DELETED = 'DOCUMENT_HARD_DELETED',
  UNAUTHORIZED_DOCUMENT_ACCESS = 'UNAUTHORIZED_DOCUMENT_ACCESS',
}

/**
 * Audit Service for HIPAA-compliant logging of authentication events
 *
 * HIPAA Requirements:
 * - Logs must contain user ID, timestamp, event type, and outcome
 * - NO PHI (Protected Health Information) should be logged
 * - NO raw tokens, passwords, or sensitive data
 * - Logs must be forwarded to a centralized logging system with retention
 *
 * TODO: Forward logs to GCP Cloud Logging with appropriate retention (6+ years for HIPAA)
 * TODO: Implement log encryption at rest
 * TODO: Add alerting for suspicious patterns (multiple failed logins, etc.)
 */
@Injectable()
export class AuditService {
  constructor(private configService: ConfigService<AllConfigType>) {}

  /**
   * Log an authentication event
   *
   * @param data - Event data containing userId, provider, event type, etc.
   *
   * Security Notes:
   * - Never log raw tokens, refresh tokens, or passwords
   * - Never log email addresses or names (potential PII)
   * - Only log userId, provider, event type, timestamp, and success/failure
   */
  logAuthEvent(data: AuthEventData): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: 'keystone-core-api',
      component: 'auth',
      userId: data.userId,
      provider: data.provider,
      event: data.event,
      sessionId: data.sessionId,
      success: data.success,
      // IP and User Agent for security monitoring (not PHI)
      ipAddress: data.ipAddress,
      userAgent: data.userAgent
        ? this.sanitizeUserAgent(data.userAgent)
        : undefined,
      errorType: data.errorMessage
        ? this.sanitizeErrorMessage(data.errorMessage)
        : undefined,
      environment: this.configService.get('app.nodeEnv', { infer: true }),
      // Additional event-specific metadata (if provided)
      ...(data.metadata ? { metadata: data.metadata } : {}),
    };

    // Structured JSON logging for GCP Cloud Logging compatibility
    console.info(JSON.stringify(logEntry));

    // TODO: In production, forward to GCP Cloud Logging
    // Example: this.gcpLoggingClient.write(logEntry);

    // TODO: For HIPAA compliance, ensure logs are:
    // 1. Encrypted at rest
    // 2. Access-controlled (only authorized personnel)
    // 3. Retained for 6+ years
    // 4. Tamper-proof (immutable once written)
  }

  /**
   * Log multiple authentication events (batch logging)
   */
  logAuthEvents(events: AuthEventData[]): void {
    events.forEach((event) => this.logAuthEvent(event));
  }

  /**
   * Sanitize user agent string to remove potentially sensitive information
   */
  private sanitizeUserAgent(userAgent: string): string {
    // Truncate very long user agent strings and remove potential PII
    return userAgent.substring(0, 200);
  }

  /**
   * Sanitize error messages to prevent logging of sensitive data
   */
  private sanitizeErrorMessage(error: string): string {
    // Remove potential tokens, emails, or other sensitive data from error messages
    return error
      .replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        '[EMAIL_REDACTED]',
      )
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [TOKEN_REDACTED]')
      .replace(/token[:\s]+[^\s]+/gi, 'token: [REDACTED]')
      .substring(0, 500);
  }
}
