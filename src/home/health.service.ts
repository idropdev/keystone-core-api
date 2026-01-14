import { Injectable, Optional, Inject } from '@nestjs/common';
import { GcpStorageAdapter } from '../document-processing/infrastructure/storage/gcp-storage.adapter';
import { AnythingLLMHealthService } from '../anythingllm/services/anythingllm-health.service';

/**
 * Health Check Service
 *
 * Provides health check endpoints for critical infrastructure components.
 * Used by monitoring systems and load balancers to verify service health.
 */
@Injectable()
export class HealthService {
  constructor(
    @Optional()
    @Inject(GcpStorageAdapter)
    private readonly gcpStorageAdapter?: GcpStorageAdapter,
    @Optional()
    @Inject(AnythingLLMHealthService)
    private readonly anythingllmHealthService?: AnythingLLMHealthService,
  ) {}

  /**
   * Check GCP Storage health
   * Verifies that GCP Cloud Storage is accessible and authenticated
   */
  async checkGcpHealth(): Promise<{
    status: string;
    bucket?: string;
    accessible?: boolean;
    error?: string;
  }> {
    // If GCP storage adapter is not available, return unhealthy
    if (!this.gcpStorageAdapter) {
      return {
        status: 'unhealthy',
        error: 'GCP Storage adapter not available',
      };
    }

    // Use the adapter's health check method
    return this.gcpStorageAdapter.healthCheck();
  }

  /**
   * Check AnythingLLM connectivity and service identity authentication
   * Verifies that Keystone can communicate with AnythingLLM using service identity
   */
  async checkAnythingLLMHealth(): Promise<{
    status: 'healthy' | 'unhealthy' | 'degraded';
    endpoint?: string;
    reachable?: boolean;
    authenticated?: boolean;
    responseTime?: number;
    error?: string;
    timestamp?: string;
  }> {
    // If AnythingLLM health service is not available, return unhealthy
    if (!this.anythingllmHealthService) {
      return {
        status: 'unhealthy',
        error: 'AnythingLLM health service not available',
        timestamp: new Date().toISOString(),
      };
    }

    // Use the AnythingLLM health service's health check method
    return this.anythingllmHealthService.checkHealth();
  }
}
