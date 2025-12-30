import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket, File } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import {
  StorageServicePort,
  FileMetadata,
} from '../../domain/ports/storage.service.port';
import { AllConfigType } from '../../../config/config.type';

/**
 * GCP Cloud Storage Adapter
 *
 * HIPAA Compliance Notes:
 * - Server-side encryption: Google-managed keys by default
 * - TODO: Enable CMEK (Customer-Managed Encryption Keys) for production
 * - TODO: Configure bucket with Uniform Bucket-Level Access (UBLA)
 * - TODO: Set bucket lifecycle policy to delete after 8 years
 * - TODO: Enable audit logging on bucket (Data Access logs)
 *
 * IAM Requirements:
 * - Service account needs: roles/storage.objectCreator, roles/storage.objectViewer
 * - Limit permissions to specific bucket(s) only
 *
 * Security:
 * - Never log GCS URIs at INFO level (contains PHI file paths)
 * - Never log file contents
 * - Use signed URLs with short expiry for downloads
 */
@Injectable()
export class GcpStorageAdapter implements StorageServicePort {
  private readonly logger = new Logger(GcpStorageAdapter.name);
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly rawPrefix: string;
  private readonly processedPrefix: string;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    // Initialize Storage with proper credential handling (same pattern as Document AI and Vision AI)
    // Priority:
    // 1. Direct service account key (if GOOGLE_APPLICATION_CREDENTIALS points to a service account JSON)
    // 2. ADC (Application Default Credentials) - recommended for local dev and GCP compute
    // 3. Impersonation credentials (if detected, will use ADC but may fail if IAM not configured)
    const credentialsPathEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    // Resolve relative paths to absolute paths
    const credentialsPath = credentialsPathEnv
      ? path.isAbsolute(credentialsPathEnv)
        ? credentialsPathEnv
        : path.resolve(process.cwd(), credentialsPathEnv)
      : undefined;

    const credentialInfo = this.detectCredentialType(credentialsPath);

    if (credentialsPath && credentialInfo.type === 'service_account') {
      // Direct service account key - can use keyFilename (required for signed URLs)
      this.logger.log(
        `GCP Storage initialized with direct service account key: ${credentialsPath}`,
      );
      if (credentialInfo.clientEmail) {
        this.logger.log(`  Service account: ${credentialInfo.clientEmail}`);
      }
      this.storage = new Storage({
        keyFilename: credentialsPath,
      });
    } else if (
      credentialsPath &&
      credentialInfo.type === 'impersonated_service_account'
    ) {
      // Impersonation credentials detected - warn user
      this.logger.warn(
        '⚠️  [GCP STORAGE] Impersonation credentials detected. Signed URLs will not work with impersonation.',
      );
      this.logger.warn(
        '   For signed URLs, use a direct service account key file (type: service_account).',
      );
      this.logger.warn('   Current file type: impersonated_service_account');

      // Still try to use ADC (library will read GOOGLE_APPLICATION_CREDENTIALS)
      this.storage = new Storage();
    } else if (credentialsPath && credentialInfo.type === 'unknown') {
      // File exists but couldn't determine type - try to use it anyway
      this.logger.warn(
        `⚠️  [GCP STORAGE] Could not determine credential type for: ${credentialsPath}`,
      );
      this.logger.warn(
        '   Attempting to use as service account key. If this fails, verify the file is a valid service account JSON.',
      );
      this.storage = new Storage({
        keyFilename: credentialsPath,
      });
    } else if (credentialsPath && !credentialInfo.exists) {
      // File doesn't exist
      this.logger.error(
        `❌ [GCP STORAGE] Credentials file not found: ${credentialsPath}`,
      );
      this.logger.error('   Falling back to ADC. Signed URLs will not work.');
      this.storage = new Storage();
    } else {
      // No GOOGLE_APPLICATION_CREDENTIALS set - use ADC directly
      this.logger.log(
        '[GCP STORAGE] Using Application Default Credentials (ADC).',
      );
      this.logger.warn(
        '  NOTE: Signed URLs require a service account key file, not ADC.',
      );

      this.storage = new Storage();
    }

    const bucketName = this.configService.getOrThrow(
      'documentProcessing.gcp.storage.bucket',
      { infer: true },
    );

    this.bucket = this.storage.bucket(bucketName);

    this.rawPrefix = this.configService.getOrThrow(
      'documentProcessing.gcp.storage.rawPrefix',
      { infer: true },
    );

    this.processedPrefix = this.configService.getOrThrow(
      'documentProcessing.gcp.storage.processedPrefix',
      { infer: true },
    );

    this.logger.log('GCP Storage adapter initialized');

    // Validate credentials for signed URL generation
    this.validateSignedUrlCredentials();
    // TODO: Verify bucket exists and is accessible on startup
  }

  /**
   * Detect credential type from file
   * Returns information about the credential file
   */
  private detectCredentialType(credentialsPath?: string): {
    type:
      | 'service_account'
      | 'impersonated_service_account'
      | 'authorized_user'
      | 'unknown';
    exists: boolean;
    clientEmail?: string;
  } {
    if (!credentialsPath) {
      return { type: 'unknown', exists: false };
    }

    try {
      if (!fs.existsSync(credentialsPath)) {
        this.logger.warn(
          `[GCP STORAGE] Credentials file does not exist: ${credentialsPath}`,
        );
        return { type: 'unknown', exists: false };
      }

      const keyContent = fs.readFileSync(credentialsPath, 'utf8');
      const keyJson = JSON.parse(keyContent);

      const credentialType = keyJson.type;

      if (credentialType === 'service_account') {
        return {
          type: 'service_account',
          exists: true,
          clientEmail: keyJson.client_email,
        };
      } else if (credentialType === 'impersonated_service_account') {
        return {
          type: 'impersonated_service_account',
          exists: true,
        };
      } else if (credentialType === 'authorized_user') {
        return {
          type: 'authorized_user',
          exists: true,
        };
      } else {
        this.logger.warn(
          `[GCP STORAGE] Unknown credential type: ${credentialType || 'undefined'}`,
        );
        return {
          type: 'unknown',
          exists: true,
        };
      }
    } catch (error) {
      this.logger.warn(
        `[GCP STORAGE] Could not parse credentials file: ${this.sanitizeError(error)}`,
      );
      return { type: 'unknown', exists: true };
    }
  }

  /**
   * Detect if credentials file contains impersonation credentials
   * @deprecated Use detectCredentialType instead
   */
  private detectImpersonationCredentials(credentialsPath?: string): boolean {
    const info = this.detectCredentialType(credentialsPath);
    return info.type === 'impersonated_service_account';
  }

  /**
   * Validate that credentials are configured for signed URL generation
   * This is a best-effort check - actual validation happens at runtime
   */
  private validateSignedUrlCredentials(): void {
    const credentialsPathEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsPathEnv) {
      this.logger.warn(
        '⚠️  GOOGLE_APPLICATION_CREDENTIALS not set. Signed URL generation will fail.',
      );
      this.logger.warn(
        '   Set GOOGLE_APPLICATION_CREDENTIALS to a service account key file path.',
      );
      this.logger.warn(
        '   Application Default Credentials cannot be used for signed URLs.',
      );
      return;
    }

    // Resolve relative paths to absolute paths
    const credentialsPath = path.isAbsolute(credentialsPathEnv)
      ? credentialsPathEnv
      : path.resolve(process.cwd(), credentialsPathEnv);

    const credentialInfo = this.detectCredentialType(credentialsPath);

    if (!credentialInfo.exists) {
      this.logger.error(
        `❌ Service account key file not found: ${credentialsPath}`,
      );
      this.logger.error(`   Original path from env: ${credentialsPathEnv}`);
      this.logger.error(`   Resolved absolute path: ${credentialsPath}`);
      return;
    }

    // Validate based on credential type
    if (credentialInfo.type === 'service_account') {
      if (credentialInfo.clientEmail) {
        this.logger.log(
          `✅ Service account credentials validated: ${credentialInfo.clientEmail}`,
        );
        this.logger.log(`   File: ${credentialsPath}`);
      } else {
        this.logger.error(
          `❌ Service account key file missing 'client_email' field: ${credentialsPath}`,
        );
      }
    } else if (credentialInfo.type === 'impersonated_service_account') {
      this.logger.warn(
        `⚠️  Impersonation credentials detected. Signed URLs may not work reliably.`,
      );
      this.logger.warn(`   File: ${credentialsPath}`);
      this.logger.warn(
        '   For signed URLs, use a direct service account key (type: service_account).',
      );
    } else if (credentialInfo.type === 'authorized_user') {
      this.logger.warn(
        `⚠️  User credentials detected (type: authorized_user). Signed URL generation will fail.`,
      );
      this.logger.warn(
        '   For signed URLs, use a service account key file (type: service_account).',
      );
    } else {
      this.logger.warn(`⚠️  Unknown credential type. Signed URLs may fail.`);
      this.logger.warn(`   File: ${credentialsPath}`);
    }
  }

  async storeRaw(fileBuffer: Buffer, metadata: FileMetadata): Promise<string> {
    try {
      // Build deterministic object key: raw/{userId}/{documentId}_{fileName}
      const objectKey = `${this.rawPrefix}${metadata.userId}/${metadata.documentId}_${metadata.fileName}`;

      const file: File = this.bucket.file(objectKey);

      // Upload with resumable upload (automatic for files > 5MB)
      await file.save(fileBuffer, {
        contentType: metadata.mimeType,
        resumable: true,
        metadata: {
          // Custom metadata (searchable via GCS API)
          documentId: metadata.documentId,
          userId: metadata.userId.toString(),
          originalFileName: metadata.fileName,
          uploadedAt: new Date().toISOString(),
        },
        // TODO: Enable CMEK for production
        // kmsKeyName: process.env.GCS_KMS_KEY_NAME,

        // TODO: Enable CSEK if required (customer-supplied encryption key)
        // encryptionKey: Buffer.from(process.env.GCS_ENCRYPTION_KEY_BASE64, 'base64'),
      });

      const gcsUri = `gs://${this.bucket.name}/${objectKey}`;

      // SECURITY: Only log at DEBUG level, mask URI
      this.logger.debug(
        `Uploaded raw file for document ${metadata.documentId} (${(metadata.contentLength / 1024).toFixed(2)} KB)`,
      );

      return gcsUri;
    } catch (error) {
      const authError = this.detectAuthError(error);
      if (authError) {
        this.logger.error(
          `GCP authentication error for document ${metadata.documentId}: ${authError.message}`,
        );
        this.logger.error(authError.remediation);
        throw new Error(authError.userMessage);
      }

      // Check for specific error types and provide remediation guidance
      const errorMessage = (error as Error).message || String(error);
      const credentialsPathEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const credentialsPath = credentialsPathEnv
        ? path.isAbsolute(credentialsPathEnv)
          ? credentialsPathEnv
          : path.resolve(process.cwd(), credentialsPathEnv)
        : undefined;
      const credentialInfo = this.detectCredentialType(credentialsPath);

      // Only show impersonation error if we actually detected impersonation credentials
      if (
        (errorMessage.includes('unable to impersonate') ||
          errorMessage.includes('Invalid form of account ID')) &&
        credentialInfo.type === 'impersonated_service_account'
      ) {
        this.logger.error(
          `[GCP STORAGE] Upload failed due to service account impersonation error: ${this.sanitizeError(error)}`,
        );
        this.logger.error(
          '⚠️  Service account impersonation is failing. For signed URLs, use a direct service account key (type: service_account).',
        );
      } else if (
        errorMessage.includes('Invalid form of account ID') &&
        credentialInfo.type === 'service_account'
      ) {
        // This might be a malformed service account key
        this.logger.error(
          `[GCP STORAGE] Upload failed - invalid service account key format: ${this.sanitizeError(error)}`,
        );
        this.logger.error(`   Credentials file: ${credentialsPath}`);
        this.logger.error(
          '   Verify the service account key file is valid and contains a proper client_email field.',
        );
        this.logger.error(
          '   Regenerate the key if needed: gcloud iam service-accounts keys create key.json --iam-account=SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com',
        );
      } else {
        this.logger.error(
          `Failed to upload raw file for document ${metadata.documentId}: ${this.sanitizeError(error)}`,
        );
        if (credentialsPath) {
          this.logger.error(
            `   Credentials file: ${credentialsPath} (type: ${credentialInfo.type || 'unknown'})`,
          );
        }
      }
      throw new Error('Failed to upload document to storage');
    }
  }

  async storeProcessed(jsonData: any, metadata: FileMetadata): Promise<string> {
    try {
      const objectKey = `${this.processedPrefix}${metadata.userId}/${metadata.documentId}.json`;

      const file: File = this.bucket.file(objectKey);

      const jsonString = JSON.stringify(jsonData, null, 2);
      const buffer = Buffer.from(jsonString, 'utf-8');

      await file.save(buffer, {
        contentType: 'application/json',
        resumable: false, // JSON is usually small
        metadata: {
          documentId: metadata.documentId,
          userId: metadata.userId.toString(),
          processedAt: new Date().toISOString(),
        },
      });

      const gcsUri = `gs://${this.bucket.name}/${objectKey}`;

      this.logger.debug(
        `Stored processed output for document ${metadata.documentId}`,
      );

      return gcsUri;
    } catch (error) {
      const authError = this.detectAuthError(error);
      if (authError) {
        this.logger.error(
          `GCP authentication error for document ${metadata.documentId}: ${authError.message}`,
        );
        this.logger.error(authError.remediation);
        throw new Error(authError.userMessage);
      }

      // Check for impersonation errors
      const errorMessage = (error as Error).message || String(error);
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const isImpersonationCredentials =
        this.detectImpersonationCredentials(credentialsPath);

      if (
        (errorMessage.includes('unable to impersonate') ||
          errorMessage.includes('INVALID_ARGUMENT') ||
          errorMessage.includes('Invalid form of account ID')) &&
        isImpersonationCredentials
      ) {
        this.logger.error(
          `[GCP STORAGE] Store processed failed due to impersonation error: ${this.sanitizeError(error)}`,
        );
        this.logger.error(
          '⚠️  Use ADC directly: unset GOOGLE_APPLICATION_CREDENTIALS and run gcloud auth application-default login',
        );
      } else {
        this.logger.error(
          `Failed to store processed output for document ${metadata.documentId}: ${this.sanitizeError(error)}`,
        );
      }
      throw new Error('Failed to store processed document');
    }
  }

  async delete(gcsUri: string): Promise<void> {
    try {
      const { bucket, objectKey } = this.parseGcsUri(gcsUri);
      const file = this.storage.bucket(bucket).file(objectKey);

      await file.delete();

      this.logger.debug(
        'Deleted file from GCS (hard delete for retention policy)',
      );
    } catch (error) {
      // If file doesn't exist, consider it success (idempotent)
      if ((error as any).code === 404) {
        this.logger.debug('File already deleted or does not exist');
        return;
      }

      const authError = this.detectAuthError(error);
      if (authError) {
        this.logger.error(
          `GCP authentication error during delete: ${authError.message}`,
        );
        this.logger.error(authError.remediation);
        throw new Error(authError.userMessage);
      }

      this.logger.error(
        `Failed to delete file from GCS: ${this.sanitizeError(error)}`,
      );
      throw new Error('Failed to delete file from storage');
    }
  }

  async getSignedUrl(
    gcsUri: string,
    expiresIn: number = 86400,
  ): Promise<string> {
    try {
      const { bucket, objectKey } = this.parseGcsUri(gcsUri);
      const file = this.storage.bucket(bucket).file(objectKey);

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresIn * 1000,
      });

      this.logger.debug(`Generated signed URL (expires in ${expiresIn}s)`);

      return url;
    } catch (error) {
      const authError = this.detectAuthError(error);
      if (authError) {
        // Log detailed error and remediation on server side only (security: don't expose to clients)
        this.logger.error(
          `GCP authentication error generating signed URL: ${authError.message}`,
        );
        this.logger.error(authError.remediation);
        // Return generic error to client (no internal details exposed)
        throw new ServiceUnavailableException(
          'Service temporarily unavailable. Please contact support if this issue persists.',
        );
      }

      this.logger.error(
        `Failed to generate signed URL: ${this.sanitizeError(error)}`,
      );
      // Return generic error to client (no internal details exposed)
      throw new ServiceUnavailableException(
        'Service temporarily unavailable. Please contact support if this issue persists.',
      );
    }
  }

  /**
   * Parse GCS URI into bucket and object key
   * @param gcsUri - gs://bucket-name/path/to/object
   */
  private parseGcsUri(gcsUri: string): { bucket: string; objectKey: string } {
    if (!gcsUri.startsWith('gs://')) {
      throw new Error('Invalid GCS URI format');
    }

    const parts = gcsUri.replace('gs://', '').split('/');
    const bucket = parts[0];
    const objectKey = parts.slice(1).join('/');

    return { bucket, objectKey };
  }

  /**
   * Detect authentication errors and provide remediation guidance
   */
  private detectAuthError(error: any): {
    message: string;
    userMessage: string;
    remediation: string;
  } | null {
    const errorStr = JSON.stringify(error || {});
    const errorMessage = error?.message || errorStr;
    const errorCode = error?.code;
    const errorSubtype = error?.error_subtype;

    // Check for missing client_email (required for signed URLs)
    if (
      errorMessage.includes('Cannot sign data without') ||
      errorMessage.includes('client_email') ||
      errorMessage.includes('client_email is required')
    ) {
      const hasServiceAccount = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const remediation = hasServiceAccount
        ? `Service account key file is set but may be invalid or missing client_email. Verify:
   1. GOOGLE_APPLICATION_CREDENTIALS points to a valid service account JSON key file
   2. The JSON file contains a "client_email" field (not user credentials)
   3. The service account has required permissions (roles/storage.objectAdmin)
   4. Regenerate the service account key if needed:
      gcloud iam service-accounts keys create key.json --iam-account=SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com`
        : `Signed URLs require a service account key file (not Application Default Credentials).

   To fix:
   1. Create a service account (if you don't have one):
      gcloud iam service-accounts create keystone-doc-processing \\
        --display-name="Keystone Document Processing"

   2. Grant required permissions:
      gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \\
        --member="serviceAccount:keystone-doc-processing@YOUR_PROJECT_ID.iam.gserviceaccount.com" \\
        --role="roles/storage.objectAdmin"

   3. Create and download the key:
      gcloud iam service-accounts keys create ~/keystone-sa-key.json \\
        --iam-account=keystone-doc-processing@YOUR_PROJECT_ID.iam.gserviceaccount.com

   4. Set environment variable:
      export GOOGLE_APPLICATION_CREDENTIALS=~/keystone-sa-key.json

   Note: Application Default Credentials (from gcloud auth application-default login)
   cannot be used for signed URLs - you must use a service account key file.`;

      return {
        message:
          'GCP signed URL generation requires service account with client_email',
        userMessage:
          'Failed to generate download URL: Service account credentials required. Application Default Credentials cannot be used for signed URLs.',
        remediation,
      };
    }

    // Check for invalid_rapt (reauthentication required)
    if (
      errorSubtype === 'invalid_rapt' ||
      errorMessage.includes('invalid_rapt') ||
      (error?.error === 'invalid_grant' &&
        errorMessage.includes('reauth related error'))
    ) {
      const hasServiceAccount = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const remediation = hasServiceAccount
        ? `Service account credentials may be expired or invalid. Verify:
   1. GOOGLE_APPLICATION_CREDENTIALS points to a valid service account key file
   2. The service account key has not been revoked or expired
   3. The service account has required permissions (roles/storage.objectCreator, roles/storage.objectViewer)
   4. Regenerate the service account key if needed:
      gcloud iam service-accounts keys create key.json --iam-account=SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com`
        : `Application Default Credentials (ADC) have expired. Re-authenticate:
   1. Run: gcloud auth application-default login
   2. Set your project: gcloud config set project YOUR_PROJECT_ID
   3. Verify: gcloud auth application-default print-access-token

   For production, use a service account key instead of ADC:
   - Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json`;

      return {
        message: 'GCP authentication token expired (invalid_rapt)',
        userMessage:
          'GCP authentication failed: credentials expired. Please re-authenticate or update service account credentials.',
        remediation,
      };
    }

    // Check for impersonation errors
    if (
      errorMessage.includes('unable to impersonate') ||
      errorMessage.includes('Invalid form of account ID') ||
      (errorMessage.includes('INVALID_ARGUMENT') &&
        errorMessage.includes('impersonate'))
    ) {
      const credentialsPathEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const credentialsPath = credentialsPathEnv
        ? path.isAbsolute(credentialsPathEnv)
          ? credentialsPathEnv
          : path.resolve(process.cwd(), credentialsPathEnv)
        : undefined;
      const credentialInfo = this.detectCredentialType(credentialsPath);

      const remediation =
        credentialInfo.type === 'impersonated_service_account'
          ? `Service account impersonation is failing. For signed URLs, use a direct service account key (type: service_account).

   Current file: ${credentialsPath || 'not set'}
   Detected type: ${credentialInfo.type}

   To fix:
   1. Create a direct service account key (not impersonation):
      gcloud iam service-accounts keys create .secrets/keystone-doc-processing-key.json \\
        --iam-account=keystone-doc-processing@YOUR_PROJECT_ID.iam.gserviceaccount.com

   2. Ensure GOOGLE_APPLICATION_CREDENTIALS points to this file:
      export GOOGLE_APPLICATION_CREDENTIALS=.secrets/keystone-doc-processing-key.json`
          : credentialInfo.type === 'service_account'
            ? `Service account key file detected but authentication is failing. Verify:
   1. File path: ${credentialsPath || 'not set'}
   2. File exists and is readable
   3. File contains valid JSON with type: "service_account" and client_email field
   4. Service account has required permissions (roles/storage.objectAdmin)
   5. Regenerate the key if needed:
      gcloud iam service-accounts keys create .secrets/keystone-doc-processing-key.json \\
        --iam-account=SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com`
            : `GCP authentication failed. Verify:
   1. Check GOOGLE_APPLICATION_CREDENTIALS env var (if using service account)
   2. File path: ${credentialsPath || 'not set'}
   3. Or run: gcloud auth application-default login (for local dev)
   4. Verify service account has required IAM roles
   5. Check project ID matches your GCP project`;

      return {
        message: 'GCP authentication failed',
        userMessage:
          'GCP authentication failed: invalid or missing credentials.',
        remediation,
      };
    }

    // Check for other common auth errors
    if (
      errorCode === 401 ||
      errorCode === 403 ||
      errorMessage.includes('Could not load the default credentials') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('permission denied')
    ) {
      const remediation = `Verify GCP authentication:
   1. Check GOOGLE_APPLICATION_CREDENTIALS env var (if using service account)
   2. Or run: gcloud auth application-default login (for local dev)
   3. Verify service account has required IAM roles
   4. Check project ID matches your GCP project`;

      return {
        message: 'GCP authentication failed',
        userMessage:
          'GCP authentication failed: invalid or missing credentials.',
        remediation,
      };
    }

    return null;
  }

  /**
   * Sanitize error messages to avoid exposing sensitive info
   */
  private sanitizeError(error: any): string {
    const message = error?.message || String(error);
    // Remove GCS URIs, project IDs, bucket names
    return message
      .replace(/gs:\/\/[^\s]+/g, '[GCS_URI_REDACTED]')
      .replace(/projects\/[^\/\s]+/g, 'projects/[PROJECT_REDACTED]')
      .substring(0, 200);
  }
}
