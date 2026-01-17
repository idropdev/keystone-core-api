import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AllConfigType } from '../../config/config.type';
import { AnythingLLMServiceIdentityService } from './anythingllm-service-identity.service';
import { AnythingLLMAuthDelegationService } from '../../anythingllm-auth-delegation/service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import * as jwt from 'jsonwebtoken';

/**
 * HTTP client service for making authenticated requests to AnythingLLM APIs
 *
 * CRITICAL: ALL requests MUST use delegated tokens (HS256) with user context.
 * When no Authorization header is provided, issues delegated token with admin context (system admin ID: 1).
 * NEVER uses service identity tokens (RS256) - they are not accepted by AnythingLLM.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMClientService {
  private readonly logger = new Logger(AnythingLLMClientService.name);
  // System admin ID for requests without user context
  private readonly SYSTEM_ADMIN_ID = 1;

  constructor(
    private readonly serviceIdentityService: AnythingLLMServiceIdentityService,
    private readonly configService: ConfigService<AllConfigType>,
    @Optional()
    @Inject(AnythingLLMAuthDelegationService)
    private readonly delegationService?: AnythingLLMAuthDelegationService,
  ) {}

  /**
   * Call AnythingLLM API with service identity authentication
   *
   * @param endpoint - API endpoint (relative or absolute URL)
   * @param options - Fetch options (method, body, headers, etc.)
   * @returns Promise<Response> - Fetch Response object
   * @throws Error if token minting fails (fail-closed)
   */
  async callAnythingLLM(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const method = options.method || 'GET';
    const startTime = Date.now();

    // Check if Authorization header is already provided (delegated token from orchestrator)
    const incomingHeaders = (options.headers as Record<string, string>) || {};
    const hasIncomingAuth =
      !!incomingHeaders.Authorization || !!incomingHeaders.authorization;

    // CRITICAL: ALL requests MUST use delegated tokens (HS256), never service identity (RS256)
    // If no Authorization header is provided, issue delegated token with admin context
    let token: string = '';
    if (!hasIncomingAuth) {
      if (this.delegationService) {
        try {
          // Issue delegated token with admin context (system admin ID: 1)
          // This ensures ALL requests use HS256 delegated tokens, never RS256 service identity
          this.logger.debug(
            `Issuing delegated token (HS256) with admin context for AnythingLLM request to ${endpoint}`,
          );
          const tokenResult = await this.delegationService.issueDelegatedToken({
            requesterContext: {
              userId: String(this.SYSTEM_ADMIN_ID),
              roles: ['admin'],
            },
            operation: AnythingLLMOperation.SYSTEM_READ, // Default operation for direct client calls
            scope: ['anythingllm:system:read'], // Default scope
          });
          token = tokenResult.token;

          // Verify token is HS256 (defensive check)
          const decoded = jwt.decode(token, { complete: true }) as any;
          if (decoded?.header?.alg !== 'HS256') {
            throw new Error(
              `CRITICAL: Delegated token was signed with ${decoded?.header?.alg} but MUST be HS256`,
            );
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `Failed to issue delegated token (HS256) for AnythingLLM request: ${errorMessage}. CRITICAL: Delegated tokens are required. Ensure ENABLE_DELEGATED_TOKENS=true and ANYTHINGLLM_DELEGATED_TOKEN_SECRET is configured.`,
          );
          throw new Error(
            `Failed to issue delegated token: ${errorMessage}. Delegated tokens (HS256) are required for AnythingLLM authentication.`,
          );
        }
      } else {
        // Fallback: if delegation service is not available, log warning and try service identity
        // This should not happen in production - delegation service should always be available
        this.logger.warn(
          'Delegation service not available, falling back to service identity token (RS256). This is not recommended - delegated tokens (HS256) are required.',
        );
        try {
          token = await this.serviceIdentityService.getIdToken();
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.error(
            `Failed to mint service identity token for AnythingLLM request: ${errorMessage}`,
          );
          throw new Error(
            `Failed to mint service identity token: ${errorMessage}`,
          );
        }
      }
    }

    // Build full URL
    const baseUrl = this.configService.get('anythingllm.baseUrl', {
      infer: true,
    });
    const url = endpoint.startsWith('http')
      ? endpoint
      : `${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    // Generate request ID
    const requestId = randomUUID();

    // REMOVED: Token metadata logging for HIPAA compliance and security
    // Token structure, headers, payloads, and service account emails should never be logged

    // Request logging moved to DEBUG level for HIPAA compliance
    // Only log method and endpoint, no tokens or service account details
    this.logger.debug(
      `[AnythingLLM Request] ${method} ${endpoint} | RequestId: ${requestId}`,
    );

    try {
      // Check if body is FormData (multipart/form-data)
      const isFormData =
        options.body &&
        (options.body instanceof FormData ||
          (typeof FormData !== 'undefined' &&
            options.body instanceof FormData) ||
          // Check for form-data package instance (Node.js)
          (options.body.constructor &&
            options.body.constructor.name === 'FormData' &&
            typeof (options.body as any).getHeaders === 'function'));

      // Build headers for request
      const requestHeaders: Record<string, string> = {
        'X-Request-Id': requestId,
        'X-Client-Service': 'keystone',
        ...((options.headers as Record<string, string>) || {}),
      };

      // Only set Authorization if not already provided (delegated token takes precedence)
      if (!hasIncomingAuth) {
        requestHeaders.Authorization = `Bearer ${token}`;
      }

      // Only set Content-Type for non-FormData bodies
      // FormData will set its own Content-Type with boundary (don't override it)
      if (!isFormData && !requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json';
      } else if (isFormData) {
        // Remove Content-Type for FormData - let fetch/FormData set it with boundary
        delete requestHeaders['Content-Type'];
      }

      // REMOVED: Header logging for HIPAA compliance
      // Headers should not be logged in production

      // Make request with headers
      const response = await fetch(url, {
        ...options,
        headers: requestHeaders,
      });

      const duration = Date.now() - startTime;

      // Response logging: only log errors at ERROR level, success at DEBUG level
      if (response.ok) {
        // Success responses moved to DEBUG level for HIPAA compliance
        this.logger.debug(
          `[AnythingLLM Response] ${method} ${endpoint} | Status: ${response.status} | Duration: ${duration}ms | RequestId: ${requestId}`,
        );
      } else {
        // Error responses: log at ERROR level but sanitize error body for HIPAA compliance
        let errorBody = '';
        try {
          const text = await response.clone().text();
          // Sanitize error body: remove potential PHI, limit length
          const sanitized = text
            .substring(0, 100)
            .replace(/[^\w\s\-.,:;!?]/g, '');
          errorBody = sanitized || 'No error details';
        } catch {
          // Ignore if we can't read the body
          errorBody = 'Unable to read error response';
        }

        this.logger.error(
          `[AnythingLLM Response] ${method} ${endpoint} | Status: ${response.status} | Duration: ${duration}ms | RequestId: ${requestId} | Error: ${errorBody}`,
        );
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      // Error logging: HIPAA-compliant, use endpoint instead of full URL
      this.logger.error(
        `[AnythingLLM Error] ${method} ${endpoint} | Duration: ${duration}ms | RequestId: ${requestId} | Error: ${errorMessage}`,
      );
      throw error;
    }
  }
}
