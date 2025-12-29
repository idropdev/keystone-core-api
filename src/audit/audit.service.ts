import { Injectable, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
import {
  sanitizeErrorMessage,
  sanitizeUserAgent,
  sanitizeMetadata,
  validateNoPhi,
} from './utils/phi-sanitizer.util';
import { CloudLoggingClient } from './infrastructure/cloud-logging.client';

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
  // Document lifecycle events (HIPAA compliance)
  DOCUMENT_UPLOADED = 'DOCUMENT_UPLOADED',
  DOCUMENT_INTAKE_BY_USER = 'DOCUMENT_INTAKE_BY_USER', // User upload with origin selection
  DOCUMENT_STORED = 'DOCUMENT_STORED',
  DOCUMENT_PROCESSING_STARTED = 'DOCUMENT_PROCESSING_STARTED',
  DOCUMENT_PROCESSING_COMPLETED = 'DOCUMENT_PROCESSING_COMPLETED',
  DOCUMENT_PROCESSING_FAILED = 'DOCUMENT_PROCESSING_FAILED',
  DOCUMENT_PROCESSING_RETRY = 'DOCUMENT_PROCESSING_RETRY',
  DOCUMENT_REPROCESSING_STARTED = 'DOCUMENT_REPROCESSING_STARTED',
  DOCUMENT_REPROCESSING_COMPLETED = 'DOCUMENT_REPROCESSING_COMPLETED',
  DOCUMENT_METADATA_UPDATED = 'DOCUMENT_METADATA_UPDATED',
  DOCUMENT_ACCESSED = 'DOCUMENT_ACCESSED',
  DOCUMENT_DELETED = 'DOCUMENT_DELETED',
  DOCUMENT_HARD_DELETED = 'DOCUMENT_HARD_DELETED',
  DOCUMENT_RETENTION_EXTENDED = 'DOCUMENT_RETENTION_EXTENDED',
  // Access control events
  ACCESS_GRANTED = 'ACCESS_GRANTED',
  ACCESS_REVOKED = 'ACCESS_REVOKED',
  ACCESS_DELEGATED = 'ACCESS_DELEGATED',
  ACCESS_DERIVED = 'ACCESS_DERIVED',
  DOCUMENT_VIEWED = 'DOCUMENT_VIEWED',
  DOCUMENT_DOWNLOADED = 'DOCUMENT_DOWNLOADED',
  DOCUMENT_FIELDS_VIEWED = 'DOCUMENT_FIELDS_VIEWED',
  DOCUMENT_FIELDS_EDITED = 'DOCUMENT_FIELDS_EDITED',
  UNAUTHORIZED_DOCUMENT_ACCESS = 'UNAUTHORIZED_DOCUMENT_ACCESS',
  // Manager assignment events
  MANAGER_ASSIGNMENT_CREATED = 'MANAGER_ASSIGNMENT_CREATED',
  MANAGER_ASSIGNMENT_REMOVED = 'MANAGER_ASSIGNMENT_REMOVED',
  MANAGER_VERIFIED = 'MANAGER_VERIFIED',
  MANAGER_SUSPENDED = 'MANAGER_SUSPENDED',
  MANAGER_INVITED = 'MANAGER_INVITED',
  MANAGER_ONBOARDING_STARTED = 'MANAGER_ONBOARDING_STARTED',
  MANAGER_ONBOARDING_COMPLETED = 'MANAGER_ONBOARDING_COMPLETED',
  MANAGER_PROFILE_UPDATED = 'MANAGER_PROFILE_UPDATED',
  MANAGER_DELETED = 'MANAGER_DELETED',
  // Origin manager events
  ORIGIN_MANAGER_ASSIGNED = 'ORIGIN_MANAGER_ASSIGNED',
  ORIGIN_MANAGER_ACCEPTED_DOCUMENT = 'ORIGIN_MANAGER_ACCEPTED_DOCUMENT',
  // Revocation workflow events
  REVOCATION_REQUESTED = 'REVOCATION_REQUESTED',
  REVOCATION_APPROVED = 'REVOCATION_APPROVED',
  REVOCATION_DENIED = 'REVOCATION_DENIED',
  REVOCATION_CANCELLED = 'REVOCATION_CANCELLED',
  // Authority violation events
  UNAUTHORIZED_ACCESS_ATTEMPT = 'UNAUTHORIZED_ACCESS_ATTEMPT',
  ORIGIN_AUTHORITY_VIOLATION = 'ORIGIN_AUTHORITY_VIOLATION',
  PRIVILEGE_ESCALATION_ATTEMPT = 'PRIVILEGE_ESCALATION_ATTEMPT',
  // AnythingLLM provisioning events
  ANYTHINGLLM_USER_PROVISIONING_STARTED = 'ANYTHINGLLM_USER_PROVISIONING_STARTED',
  ANYTHINGLLM_USER_PROVISIONING_SUCCEEDED = 'ANYTHINGLLM_USER_PROVISIONING_SUCCEEDED',
  ANYTHINGLLM_USER_PROVISIONING_FAILED = 'ANYTHINGLLM_USER_PROVISIONING_FAILED',
  ANYTHINGLLM_WORKSPACE_ASSIGNMENT_SUCCEEDED = 'ANYTHINGLLM_WORKSPACE_ASSIGNMENT_SUCCEEDED',
  ANYTHINGLLM_WORKSPACE_ASSIGNMENT_FAILED = 'ANYTHINGLLM_WORKSPACE_ASSIGNMENT_FAILED',
  ANYTHINGLLM_USER_SUSPENSION_SYNCED = 'ANYTHINGLLM_USER_SUSPENSION_SYNCED',
  ANYTHINGLLM_USER_UNSUSPENSION_SYNCED = 'ANYTHINGLLM_USER_UNSUSPENSION_SYNCED',
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
  constructor(
    private configService: ConfigService<AllConfigType>,
    @Optional()
    @Inject(CloudLoggingClient)
    private readonly cloudLoggingClient?: CloudLoggingClient,
  ) {}

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
    // Sanitize metadata to remove any PHI
    const sanitizedMetadata = data.metadata
      ? sanitizeMetadata(data.metadata)
      : undefined;

    // Validate no PHI slipped through (throws in development, logs warning in production)
    if (sanitizedMetadata) {
      try {
        validateNoPhi(sanitizedMetadata);
      } catch (error) {
        // In development, throw to catch issues early
        // In production, log warning but don't break the application
        if (
          this.configService.get('app.nodeEnv', { infer: true }) !==
          'production'
        ) {
          throw error;
        }
        console.warn(
          `[AUDIT] PHI validation failed but continuing: ${error.message}`,
        );
      }
    }

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
      userAgent: data.userAgent ? sanitizeUserAgent(data.userAgent) : undefined,
      errorType: data.errorMessage
        ? sanitizeErrorMessage(data.errorMessage)
        : undefined,
      environment: this.configService.get('app.nodeEnv', { infer: true }),
      // Additional event-specific metadata (sanitized, no PHI)
      ...(sanitizedMetadata ? { metadata: sanitizedMetadata } : {}),
    };

    // Structured JSON logging for GCP Cloud Logging compatibility
    console.info(JSON.stringify(logEntry));

    // Forward to GCP Cloud Logging (async, non-blocking)
    if (this.cloudLoggingClient) {
      this.cloudLoggingClient.writeLog(logEntry).catch((error) => {
        // Log error but don't break the application
        console.error(
          `[AUDIT] Failed to forward to Cloud Logging: ${error.message}`,
        );
      });
    }

    // HIPAA Compliance Notes:
    // 1. ✅ Encrypted at rest (GCP default)
    // 2. ✅ Access-controlled via IAM (only authorized personnel)
    // 3. ✅ Retained for 7 years (configured in GCP)
    // 4. ✅ Tamper-proof (immutable once written in Cloud Logging)
  }

  /**
   * Log multiple authentication events (batch logging)
   */
  logAuthEvents(events: AuthEventData[]): void {
    events.forEach((event) => this.logAuthEvent(event));
  }
}
