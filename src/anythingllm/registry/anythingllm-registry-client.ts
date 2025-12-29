import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';
import {
  getEndpointDefinition,
  EndpointDefinition,
  AnythingLLMAdminEndpointId,
} from './anythingllm-endpoints.registry';
import { UpstreamError } from './upstream-error';

/**
 * Path parameters for endpoint URL building
 */
export type PathParams = Record<string, string | number>;

/**
 * Options for registry client calls
 */
export interface RegistryCallOptions<TRequest = unknown> {
  /** Path parameters to substitute in URL template */
  params?: PathParams;
  /** Request body */
  body?: TRequest;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Override timeout from endpoint definition */
  timeoutMs?: number;
}

/**
 * Result of a registry client call
 */
export interface RegistryCallResult<TResponse> {
  /** Response data */
  data: TResponse;
  /** Request ID for tracing */
  requestId: string;
  /** HTTP status code */
  status: number;
}

/**
 * AnythingLLM Registry Client
 *
 * Generic typed caller that wraps AnythingLLMClientService with:
 * - Endpoint lookup from registry
 * - URL path parameter substitution
 * - Request/response validation
 * - Normalized error handling via UpstreamError
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMRegistryClient {
  private readonly logger = new Logger(AnythingLLMRegistryClient.name);

  constructor(private readonly clientService: AnythingLLMClientService) {}

  /**
   * Call an AnythingLLM endpoint by its registry ID
   *
   * @param endpointId - Registry endpoint ID (e.g., 'admin.listUsers')
   * @param options - Call options (params, body, headers)
   * @returns Promise with typed response data
   * @throws UpstreamError on API failure
   */
  async call<TResponse = unknown, TRequest = unknown>(
    endpointId: AnythingLLMAdminEndpointId | string,
    options: RegistryCallOptions<TRequest> = {},
  ): Promise<RegistryCallResult<TResponse>> {
    const requestId = randomUUID();

    // Look up endpoint definition
    const endpoint = getEndpointDefinition(endpointId);
    if (!endpoint) {
      throw new Error(`Unknown endpoint ID: ${endpointId}`);
    }

    // Check for deprecated endpoints
    if (endpoint.deprecated) {
      this.logger.warn(
        `[Registry] Calling deprecated endpoint ${endpointId}: ${endpoint.deprecationMessage || 'No migration path specified'}`,
      );
    }

    // Build URL path with parameter substitution
    const path = this.buildPath(endpoint.path, options.params);

    // Log call intent moved to DEBUG level for HIPAA compliance
    this.logger.debug(
      `[Registry] Calling ${endpoint.method} ${path} | EndpointId: ${endpointId} | RequestId: ${requestId}`,
    );

    try {
      // Build request options
      const fetchOptions: RequestInit = {
        method: endpoint.method,
        headers: options.headers,
      };

      // Add body for methods that support it
      if (options.body && ['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      // Make authenticated request via client service
      const response = await this.clientService.callAnythingLLM(
        path,
        fetchOptions,
      );

      // Handle non-OK responses
      if (!response.ok) {
        throw await UpstreamError.fromResponse(
          response,
          requestId,
          path,
          options.body,
        );
      }

      // Parse response
      let data: TResponse;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = (await response.json()) as TResponse;
      } else {
        // For non-JSON responses, try to parse as JSON anyway
        const text = await response.text();
        try {
          data = JSON.parse(text) as TResponse;
        } catch {
          // If not JSON, wrap in object
          data = { raw: text } as unknown as TResponse;
        }
      }

      // Success logging moved to DEBUG level for HIPAA compliance
      this.logger.debug(
        `[Registry] Success ${endpoint.method} ${path} | Status: ${response.status} | RequestId: ${requestId}`,
      );

      return {
        data,
        requestId,
        status: response.status,
      };
    } catch (error) {
      // Re-throw UpstreamError as-is
      if (error instanceof UpstreamError) {
        this.logger.error(
          `[Registry] Upstream error ${endpoint.method} ${path} | Status: ${error.status} | RequestId: ${requestId} | Message: ${error.message}`,
        );
        throw error;
      }

      // Wrap other errors as UpstreamError
      const upstreamError = UpstreamError.fromNetworkError(
        error instanceof Error ? error : new Error(String(error)),
        requestId,
        path,
        options.body,
      );

      this.logger.error(
        `[Registry] Network error ${endpoint.method} ${path} | RequestId: ${requestId} | Error: ${upstreamError.message}`,
      );

      throw upstreamError;
    }
  }

  /**
   * Build URL path by substituting parameters
   *
   * @param pathTemplate - Path template with :param placeholders
   * @param params - Parameter values to substitute
   * @returns Built URL path
   */
  private buildPath(pathTemplate: string, params?: PathParams): string {
    if (!params) {
      return pathTemplate;
    }

    let path = pathTemplate;
    for (const [key, value] of Object.entries(params)) {
      path = path.replace(`:${key}`, encodeURIComponent(String(value)));
    }

    // Check for any remaining unsubstituted parameters
    const remaining = path.match(/:(\w+)/g);
    if (remaining) {
      throw new Error(
        `Missing path parameters: ${remaining.join(', ')} for path ${pathTemplate}`,
      );
    }

    return path;
  }

  /**
   * Get endpoint definition for inspection
   */
  getEndpoint(endpointId: string): EndpointDefinition | undefined {
    return getEndpointDefinition(endpointId);
  }
}
