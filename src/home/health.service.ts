import { Injectable, Optional, Inject } from '@nestjs/common';
import { GcpStorageAdapter } from '../document-processing/infrastructure/storage/gcp-storage.adapter';

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
}

