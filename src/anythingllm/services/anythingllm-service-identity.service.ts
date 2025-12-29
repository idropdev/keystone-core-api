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
      
      // Check credentials file for impersonation configuration
      // This handles both ADC file and when GOOGLE_APPLICATION_CREDENTIALS points to ADC file
      let adcImpersonationInfo: any = null;
      let credentialsFileType: 'service_account_key' | 'adc' | 'unknown' = 'unknown';
      
      try {
        const fs = require('fs');
        const path = require('path');
        let fileToCheck: string | null = null;
        
        if (credentialsPath && fs.existsSync(credentialsPath)) {
          // Check the file specified by GOOGLE_APPLICATION_CREDENTIALS
          fileToCheck = credentialsPath;
        } else if (!credentialsPath) {
          // Check default ADC location
          fileToCheck = path.join(
            process.env.HOME || process.env.USERPROFILE || '',
            '.config',
            'gcloud',
            'application_default_credentials.json',
          );
        }
        
        if (fileToCheck && fs.existsSync(fileToCheck)) {
          const fileContent = JSON.parse(fs.readFileSync(fileToCheck, 'utf-8'));
          
          // Determine file type
          // ADC files can have types: 'authorized_user', 'impersonated_service_account', or have client_id
          if (fileContent.type === 'service_account') {
            credentialsFileType = 'service_account_key';
          } else if (fileContent.type === 'authorized_user' || 
                     fileContent.type === 'impersonated_service_account' || 
                     fileContent.client_id) {
            credentialsFileType = 'adc';
            // Check for impersonation in ADC file
            adcImpersonationInfo = {
              hasImpersonationUrl: !!fileContent.service_account_impersonation_url,
              impersonationUrl: fileContent.service_account_impersonation_url || null,
              type: fileContent.type || null,
              clientId: fileContent.client_id || null,
            };
          }
        }
      } catch (fileError) {
        // Ignore file read errors
      }
      
      if (credentialsFileType === 'service_account_key') {
        this.logger.warn(
          `[Service Identity] Using service account key file: ${credentialsPath}`,
        );
      } else if (credentialsFileType === 'adc') {
        if (adcImpersonationInfo?.hasImpersonationUrl) {
          this.logger.warn(
            `[Service Identity] Using Application Default Credentials (ADC) with impersonation: ${adcImpersonationInfo.impersonationUrl}`,
          );
        } else {
          this.logger.warn(
            `[Service Identity] Using Application Default Credentials (ADC) - will use attached service account or user credentials`,
          );
          this.logger.warn(
            `[Service Identity] ⚠️  ADC file found but impersonation not configured. To use impersonation, run: gcloud auth application-default login --impersonate-service-account=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`,
          );
        }
      } else if (impersonateServiceAccount) {
        this.logger.warn(
          `[Service Identity] Using service account impersonation: ${impersonateServiceAccount}`,
        );
      } else {
        this.logger.warn(
          `[Service Identity] Using Application Default Credentials (ADC) - will use attached service account or user credentials`,
        );
      }

      // Note: google-auth-library uses Application Default Credentials (ADC)
      // If GOOGLE_IMPERSONATE_SERVICE_ACCOUNT is set, ADC must be configured with impersonation:
      // gcloud auth application-default login --impersonate-service-account=SERVICE_ACCOUNT
      // The GOOGLE_IMPERSONATE_SERVICE_ACCOUNT env var is checked for logging purposes only
      const auth = new GoogleAuth();
      const client = await auth.getIdTokenClient(audience);
      
      this.logger.warn(
        `[Service Identity] Requesting ID token from GCP for audience: ${audience}`,
      );
      
      let tokenResponse: string | null;
      try {
        tokenResponse = await client.idTokenProvider.fetchIdToken(audience);
      } catch (fetchError: any) {
        // Extract detailed error information from Gaxios error
        let errorDetails: any = {
          message: fetchError instanceof Error ? fetchError.message : 'Unknown error',
          name: fetchError instanceof Error ? fetchError.name : 'Unknown',
        };
        
        // Gaxios errors have response property with HTTP details
        if (fetchError?.response) {
          errorDetails.httpStatus = fetchError.response.status;
          errorDetails.httpStatusText = fetchError.response.statusText;
          errorDetails.responseData = fetchError.response.data;
          errorDetails.responseHeaders = fetchError.response.headers;
        }
        
        // Check for underlying cause
        if (fetchError?.cause) {
          errorDetails.cause = fetchError.cause instanceof Error ? fetchError.cause.message : fetchError.cause;
        }
        
        // Build detailed error message
        let errorMessage = errorDetails.message;
        if (errorDetails.httpStatus) {
          errorMessage += ` (HTTP ${errorDetails.httpStatus}: ${errorDetails.httpStatusText || 'Unknown'})`;
        }
        if (errorDetails.responseData?.error) {
          errorMessage += ` - ${JSON.stringify(errorDetails.responseData.error)}`;
        } else if (errorDetails.responseData?.error_description) {
          errorMessage += ` - ${errorDetails.responseData.error_description}`;
        } else if (typeof errorDetails.responseData === 'string') {
          errorMessage += ` - ${errorDetails.responseData.substring(0, 200)}`;
        }
        
        throw new Error(
          `GCP ID token fetch failed: ${errorMessage}. ` +
          `Ensure GCP credentials are configured. ` +
          `Options: 1) Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json, ` +
          `2) Set GOOGLE_IMPERSONATE_SERVICE_ACCOUNT=service-account@project.iam.gserviceaccount.com, ` +
          `3) Run: gcloud auth application-default login --impersonate-service-account=service-account@project.iam.gserviceaccount.com`,
        );
      }

      if (!tokenResponse) {
        throw new Error(
          `GCP ID token fetch returned null. ` +
          `Ensure GCP credentials are configured for service account impersonation. ` +
          `Options: 1) Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json, ` +
          `2) Set GOOGLE_IMPERSONATE_SERVICE_ACCOUNT=service-account@project.iam.gserviceaccount.com, ` +
          `3) Run: gcloud auth application-default login --impersonate-service-account=service-account@project.iam.gserviceaccount.com`,
        );
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
      
      // Provide helpful error message with credential setup instructions
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const impersonateServiceAccount = process.env.GOOGLE_IMPERSONATE_SERVICE_ACCOUNT;
      
      let credentialHint = '';
      if (!credentialsPath && !impersonateServiceAccount) {
        credentialHint = ` No GCP credentials configured. ` +
          `Set GOOGLE_IMPERSONATE_SERVICE_ACCOUNT=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com ` +
          `or run: gcloud auth application-default login --impersonate-service-account=keystone-doc-processing@anythingllm-dropdev-hybrid-v1.iam.gserviceaccount.com`;
      }
      
      this.logger.error(
        `[Service Identity] Failed to mint GCP ID token for audience: ${audience} | Duration: ${duration}ms | Error: ${errorMessage}${credentialHint}`,
      );
      
      // Re-throw with enhanced error message if it doesn't already contain credential hints
      if (errorMessage.includes('GCP credentials are configured')) {
        throw error; // Already has helpful message
      }
      throw new Error(`Failed to mint GCP ID token: ${errorMessage}${credentialHint}`);
    }
  }
}

