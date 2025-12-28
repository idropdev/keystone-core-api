import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { AllConfigType } from '../../config/config.type';

/**
 * Service for minting OIDC ID tokens for AnythingLLM service-to-service authentication
 *
 * Uses GCP service account identity to mint ID tokens via google-auth-library.
 * Tokens are cached for 55 minutes (tokens expire in 1 hour) to reduce API calls.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMServiceIdentityService {
  private readonly logger = new Logger(AnythingLLMServiceIdentityService.name);

  // Simple token cache (tokens valid for 1 hour, cache for 55 minutes)
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(private configService: ConfigService<AllConfigType>) {}

  /**
   * Get OIDC ID token for AnythingLLM service-to-service authentication
   *
   * @returns Promise<string> - The ID token
   * @throws Error if token minting fails (fail-closed)
   */
  async getIdToken(): Promise<string> {
    const serviceAuthMode = this.configService.get(
      'anythingllm.serviceAuthMode',
      { infer: true },
    );
    const serviceAudience =
      this.configService.get('anythingllm.serviceAudience', { infer: true }) ||
      'anythingllm-internal';

    this.logger.warn(
      `[Service Identity] Configuration - AuthMode: ${serviceAuthMode || 'gcp'} | Audience: ${serviceAudience}`,
    );

    if (serviceAuthMode === 'local_jwt') {
      // TODO: Implement local JWT signing if needed for local dev without GCP
      throw new Error('Local JWT mode not yet implemented in Keystone');
    }

    // Default to GCP mode
    return this.getGCPIdToken(serviceAudience);
  }

  /**
   * Get OIDC ID token using GCP service account (via google-auth-library)
   *
   * Uses Application Default Credentials (ADC) which supports:
   * - Service account attached to GCE/Cloud Run instance
   * - Service account impersonation (local development)
   * - Service account key file (via GOOGLE_APPLICATION_CREDENTIALS)
   *
   * @param audience - Token audience (must match AnythingLLM config)
   * @returns Promise<string> - The ID token
   * @throws Error if token minting fails
   */
  private async getGCPIdToken(audience: string): Promise<string> {
    // Check cache first
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      this.logger.debug(
        `[Service Identity] Using cached ID token for audience: ${audience}`,
      );
      return this.cachedToken.token;
    }

    const startTime = Date.now();
    this.logger.warn(
      `[Service Identity] Minting new GCP ID token for audience: ${audience}`,
    );

    try {
      // Log GCP credentials configuration
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const impersonateServiceAccount = process.env.GOOGLE_IMPERSONATE_SERVICE_ACCOUNT;
      
      if (credentialsPath) {
        this.logger.warn(
          `[Service Identity] Using service account key file: ${credentialsPath}`,
        );
      } else if (impersonateServiceAccount) {
        this.logger.warn(
          `[Service Identity] Using service account impersonation: ${impersonateServiceAccount}`,
        );
      } else {
        this.logger.warn(
          `[Service Identity] Using Application Default Credentials (ADC) - will use attached service account or user credentials`,
        );
      }

      const auth = new GoogleAuth();
      const client = await auth.getIdTokenClient(audience);
      
      // Log the project ID if available
      try {
        const projectId = await auth.getProjectId();
        this.logger.warn(
          `[Service Identity] GCP Project ID: ${projectId}`,
        );
      } catch (projectError) {
        this.logger.warn(
          `[Service Identity] Could not determine GCP Project ID: ${projectError instanceof Error ? projectError.message : 'Unknown error'}`,
        );
      }
      
      this.logger.warn(
        `[Service Identity] Requesting ID token from GCP for audience: ${audience}`,
      );
      
      const tokenResponse = await client.idTokenProvider.fetchIdToken(audience);

      if (!tokenResponse) {
        throw new Error('Failed to fetch ID token');
      }

      const duration = Date.now() - startTime;

      // Decode token to log metadata (without exposing the token value)
      let tokenMetadata: any = null;
      let fullPayload: any = null;
      try {
        // JWT tokens are base64url encoded, format: header.payload.signature
        const parts = tokenResponse.split('.');
        if (parts.length === 3) {
          // Decode header
          const header = JSON.parse(
            Buffer.from(parts[0], 'base64url').toString('utf-8'),
          );
          
          // Decode payload (second part)
          fullPayload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf-8'),
          );
          
          tokenMetadata = {
            email: fullPayload.email || fullPayload.azp || 'unknown',
            aud: fullPayload.aud,
            iss: fullPayload.iss,
            exp: fullPayload.exp,
            iat: fullPayload.iat,
            expTime: fullPayload.exp ? new Date(fullPayload.exp * 1000).toISOString() : 'unknown',
            tokenLength: tokenResponse.length,
          };
          
          // Log full token structure for debugging (without the actual token value)
          this.logger.warn(
            `[Service Identity] Token Header: ${JSON.stringify(header)}`,
          );
          this.logger.warn(
            `[Service Identity] Token Payload (all claims): ${JSON.stringify(fullPayload)}`,
          );
        }
      } catch (decodeError) {
        this.logger.warn(
          `[Service Identity] Could not decode token metadata: ${decodeError instanceof Error ? decodeError.message : 'Unknown error'}`,
        );
      }

      // Cache token (expires in 1 hour, cache for 55 minutes)
      this.cachedToken = {
        token: tokenResponse,
        expiresAt: Date.now() + 55 * 60 * 1000, // 55 minutes
      };

      if (tokenMetadata) {
        this.logger.warn(
          `[Service Identity] Successfully minted GCP ID token | Audience: ${audience} | Service Account: ${tokenMetadata.email} | Token Audience: ${tokenMetadata.aud} | Expires: ${tokenMetadata.expTime} | Duration: ${duration}ms | Token Length: ${tokenMetadata.tokenLength} bytes`,
        );
      } else {
        this.logger.warn(
          `[Service Identity] Successfully minted GCP ID token for audience: ${audience} | Duration: ${duration}ms | Cached for 55 minutes`,
        );
      }

      return tokenResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[Service Identity] Failed to mint GCP ID token for audience: ${audience} | Duration: ${duration}ms | Error: ${errorMessage}`,
      );
      throw new Error(`Failed to mint GCP ID token: ${errorMessage}`);
    }
  }
}

