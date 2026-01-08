import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AllConfigType } from '../../config/config.type';
import { AnythingLLMServiceIdentityService } from './anythingllm-service-identity.service';

/**
 * HTTP client service for making authenticated requests to AnythingLLM APIs
 *
 * Automatically adds service identity authentication headers to all requests.
 * Uses Bearer token authentication with OIDC ID tokens minted via GCP service account.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMClientService {
  private readonly logger = new Logger(AnythingLLMClientService.name);

  constructor(
    private readonly serviceIdentityService: AnythingLLMServiceIdentityService,
    private readonly configService: ConfigService<AllConfigType>,
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
    const hasIncomingAuth = !!incomingHeaders.Authorization || !!incomingHeaders.authorization;

    // Get service identity token only if not already provided
    let token: string = '';
    if (!hasIncomingAuth) {
      try {
        // Token minting logging moved to DEBUG level for HIPAA compliance
        this.logger.debug(
          `Minting service identity token for AnythingLLM request to ${endpoint}`,
        );
        token = await this.serviceIdentityService.getIdToken();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        // Error logging: HIPAA-compliant, no endpoint details that might contain PHI
        this.logger.error(
          `Failed to mint service identity token for AnythingLLM request: ${errorMessage}`,
        );
        throw new Error(`Failed to mint service identity token: ${errorMessage}`);
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
