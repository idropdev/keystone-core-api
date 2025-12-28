import { Injectable, Logger } from '@nestjs/common';
import { AnythingLLMClientService } from './anythingllm-client.service';

/**
 * Health check service for AnythingLLM connectivity
 *
 * Provides methods to verify that Keystone can communicate with AnythingLLM
 * using service identity authentication.
 */
@Injectable()
export class AnythingLLMHealthService {
  private readonly logger = new Logger(AnythingLLMHealthService.name);

  constructor(
    private readonly anythingllmClient: AnythingLLMClientService,
  ) {}

  /**
   * Check AnythingLLM connectivity and service identity authentication
   *
   * Uses the simplest endpoint (/v1/admin/is-multi-user-mode) to verify:
   * 1. Service identity token can be minted
   * 2. AnythingLLM is accessible
   * 3. Service identity authentication works
   *
   * @returns Health check result with status and details
   */
  async checkHealth(): Promise<{
    status: 'healthy' | 'unhealthy' | 'degraded';
    endpoint: string;
    reachable?: boolean;
    authenticated?: boolean;
    responseTime?: number;
    error?: string;
    timestamp: string;
    diagnostics?: {
      tokenServiceAccount?: string;
      tokenAudience?: string;
      baseUrl?: string;
      serviceAuthMode?: string;
    };
  }> {
    const endpoint = '/v1/admin/is-multi-user-mode';
    const startTime = Date.now();

    this.logger.warn(
      `[AnythingLLM Health Check] Starting health check to ${endpoint}`,
    );

    try {
      const response = await this.anythingllmClient.callAnythingLLM(endpoint, {
        method: 'GET',
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        let errorDetails = errorText;
        try {
          const errorJson = JSON.parse(errorText);
          errorDetails = JSON.stringify(errorJson);
        } catch {
          // Use text as-is if not JSON
        }

        this.logger.error(
          `[AnythingLLM Health Check] Health check failed | Status: ${response.status} | Error: ${errorDetails} | Response Time: ${responseTime}ms`,
        );
        this.logger.error(
          `[AnythingLLM Health Check] Debug Info | Endpoint: ${endpoint} | Status Code: ${response.status} | Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`,
        );

        return {
          status: 'unhealthy',
          endpoint,
          reachable: true,
          authenticated: false,
          responseTime,
          error: `HTTP ${response.status}: ${errorDetails.substring(0, 500)}`,
          timestamp: new Date().toISOString(),
        };
      }

      // Try to parse response to verify it's valid JSON
      const data = await response.json().catch(() => null);

      this.logger.warn(
        `[AnythingLLM Health Check] Health check successful: Status ${response.status} | Response time: ${responseTime}ms`,
      );

      return {
        status: 'healthy',
        endpoint,
        reachable: true,
        authenticated: true,
        responseTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Determine if it's an authentication error or connectivity error
      const isAuthError =
        errorMessage.includes('token') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('401') ||
        errorMessage.includes('Unauthorized');
      const isConnectivityError =
        errorMessage.includes('fetch') ||
        errorMessage.includes('network') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('ETIMEDOUT');

      this.logger.error(
        `[AnythingLLM Health Check] Health check failed | Error: ${errorMessage} | Response Time: ${responseTime}ms | IsAuthError: ${isAuthError} | IsConnectivityError: ${isConnectivityError}`,
      );
      this.logger.error(
        `[AnythingLLM Health Check] Stack trace: ${error instanceof Error ? error.stack : 'No stack trace available'}`,
      );

      return {
        status: isAuthError ? 'unhealthy' : 'degraded',
        endpoint,
        reachable: !isConnectivityError,
        authenticated: false,
        responseTime,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

