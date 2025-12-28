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

    // Get service identity token
    let token: string;
    try {
      this.logger.debug(`Minting service identity token for AnythingLLM request to ${endpoint}`);
      token = await this.serviceIdentityService.getIdToken();
      this.logger.debug(`Service identity token minted successfully`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to mint service identity token for AnythingLLM request to ${endpoint}: ${errorMessage}`,
      );
      throw new Error(`Failed to mint service identity token: ${errorMessage}`);
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

    // Log token metadata (without exposing the token value)
    let tokenMetadata: any = null;
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const header = JSON.parse(
          Buffer.from(parts[0], 'base64url').toString('utf-8'),
        );
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64url').toString('utf-8'),
        );
        tokenMetadata = {
          email: payload.email || payload.azp || 'unknown',
          aud: payload.aud,
          exp: payload.exp,
          tokenLength: token.length,
          tokenPrefix: token.substring(0, 20) + '...',
        };
        
        // Log full token structure being sent (for debugging)
        this.logger.warn(
          `[AnythingLLM Request] Token being sent - Header: ${JSON.stringify(header)} | Payload Claims: ${JSON.stringify(payload)}`,
        );
      }
    } catch (decodeError) {
      this.logger.warn(
        `[AnythingLLM Request] Could not decode token for logging: ${decodeError instanceof Error ? decodeError.message : 'Unknown error'}`,
      );
    }

    // Log outgoing request (HIPAA-compliant: no tokens, no PHI)
    if (tokenMetadata) {
      this.logger.warn(
        `[AnythingLLM Request] ${method} ${url} | RequestId: ${requestId} | Token Service Account: ${tokenMetadata.email} | Token Audience: ${tokenMetadata.aud} | Token Length: ${tokenMetadata.tokenLength} bytes`,
      );
    } else {
      this.logger.warn(
        `[AnythingLLM Request] ${method} ${url} | RequestId: ${requestId}`,
      );
    }

    try {
      // Build headers for request
      const requestHeaders: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'X-Request-Id': requestId,
        'X-Client-Service': 'keystone',
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };

      // Log all headers being sent (without the token value)
      const headersForLogging = { ...requestHeaders };
      if (headersForLogging.Authorization) {
        headersForLogging.Authorization = `Bearer <REDACTED-${token.length} chars>`;
      }
      this.logger.warn(
        `[AnythingLLM Request] Headers being sent: ${JSON.stringify(headersForLogging)}`,
      );

      // Make request with service identity headers
      const response = await fetch(url, {
        ...options,
        headers: requestHeaders,
      });

      const duration = Date.now() - startTime;

      // Log response (HIPAA-compliant: no tokens, no PHI)
      if (response.ok) {
        this.logger.warn(
          `[AnythingLLM Response] ${method} ${url} | Status: ${response.status} | Duration: ${duration}ms | RequestId: ${requestId}`,
        );
      } else {
        // Get response body for error details
        let errorBody = '';
        try {
          const text = await response.clone().text();
          errorBody = text.substring(0, 200); // Limit to 200 chars
        } catch {
          // Ignore if we can't read the body
        }

        this.logger.warn(
          `[AnythingLLM Response] ${method} ${url} | Status: ${response.status} | Duration: ${duration}ms | RequestId: ${requestId} | Error: ${errorBody || 'No error details'}`,
        );
      }

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[AnythingLLM Error] ${method} ${url} | Duration: ${duration}ms | RequestId: ${requestId} | Error: ${errorMessage}`,
      );
      throw error;
    }
  }
}

