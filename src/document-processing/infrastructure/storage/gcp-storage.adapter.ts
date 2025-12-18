import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket, File } from '@google-cloud/storage';
import * as fs from 'fs';
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
    // Initialize Storage with explicit credentials if GOOGLE_APPLICATION_CREDENTIALS is set
    // This ensures signed URLs work (requires service account with client_email)
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credentialsPath) {
      this.storage = new Storage({
        keyFilename: credentialsPath,
      });
      this.logger.log(
        `GCP Storage initialized with service account: ${credentialsPath}`,
      );
    } else {
      // Fallback to ADC (Application Default Credentials)
      // NOTE: ADC may not work for signed URLs - requires service account with client_email
      this.storage = new Storage();
      this.logger.warn(
        'GCP Storage initialized with ADC. Signed URLs require a service account key file. Set GOOGLE_APPLICATION_CREDENTIALS for production.',
      );
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
   * Validate that credentials are configured for signed URL generation
   * This is a best-effort check - actual validation happens at runtime
   */
  private validateSignedUrlCredentials(): void {
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credentialsPath) {
      this.logger.warn(
        '⚠️  GOOGLE_APPLICATION_CREDENTIALS not set. Signed URL generation will fail.',
      );
      this.logger.warn(
        '   Set GOOGLE_APPLICATION_CREDENTIALS to a service account key file path.',
      );
      this.logger.warn(
        '   Application Default Credentials cannot be used for signed URLs.',
      );
    } else {
      // Try to verify the file exists and is readable
      try {
        if (!fs.existsSync(credentialsPath)) {
          this.logger.error(
            `❌ Service account key file not found: ${credentialsPath}`,
          );
        } else {
          // Try to parse JSON to verify it's a valid service account key
          const keyContent = fs.readFileSync(credentialsPath, 'utf8');
          const keyJson = JSON.parse(keyContent);
          if (!keyJson.client_email) {
            this.logger.error(
              `❌ Service account key file missing 'client_email' field: ${credentialsPath}`,
            );
            this.logger.error(
              '   This file may be user credentials, not a service account key.',
            );
          } else {
            this.logger.log(
              `✅ Service account credentials validated: ${keyJson.client_email}`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `⚠️  Could not validate service account key file: ${credentialsPath}`,
        );
        this.logger.warn(`   Error: ${(error as Error).message}`);
      }
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

      this.logger.error(
        `Failed to upload raw file for document ${metadata.documentId}: ${this.sanitizeError(error)}`,
      );
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

      this.logger.error(
        `Failed to store processed output for document ${metadata.documentId}: ${this.sanitizeError(error)}`,
      );
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
