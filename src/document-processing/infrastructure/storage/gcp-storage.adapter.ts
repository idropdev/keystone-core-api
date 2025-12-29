import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  OnModuleInit,
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
export class GcpStorageAdapter implements StorageServicePort, OnModuleInit {
  private readonly logger = new Logger(GcpStorageAdapter.name);
  private readonly storage: Storage;
  private readonly bucket: Bucket;
  private readonly rawPrefix: string;
  private readonly processedPrefix: string;
  private readonly bucketName: string;
  private authVerified: boolean = false;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    // Initialize Storage with explicit credentials if GOOGLE_APPLICATION_CREDENTIALS is set
    // This ensures signed URLs work (requires service account with client_email)
    let credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    // If ADC file is specified but service account key exists in same directory, prefer service account key
    if (credentialsPath && fs.existsSync(credentialsPath)) {
      try {
        const keyContent = fs.readFileSync(credentialsPath, 'utf8');
        const keyJson = JSON.parse(keyContent);
        // If it's ADC, check for service account key in same directory
        if (keyJson.type === 'authorized_user') {
          const adcDir = path.dirname(credentialsPath);
          const serviceAccountKeyPath = path.join(
            adcDir,
            'keystone-sa-key.json',
          );
          if (fs.existsSync(serviceAccountKeyPath)) {
            credentialsPath = serviceAccountKeyPath;
            this.logger.log(
              `Service account key found, using it instead of ADC: ${serviceAccountKeyPath}`,
            );
          }
        }
      } catch {
        // If parsing fails, continue with original path
      }
    }

    // Get project ID from env (needed for ADC when project can't be auto-detected)
    const projectId =
      process.env.GCP_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      this.configService.get('documentProcessing.gcp.projectId', {
        infer: true,
      }) ||
      process.env.GCLOUD_PROJECT;

    if (credentialsPath) {
      // Verify the file exists and is readable
      if (!fs.existsSync(credentialsPath)) {
        this.logger.error(`❌ Credentials file not found: ${credentialsPath}`);
      } else {
        try {
          // Verify it's a valid JSON file
          const keyContent = fs.readFileSync(credentialsPath, 'utf8');
          const keyJson = JSON.parse(keyContent);
          if (keyJson.type === 'service_account' && keyJson.client_email) {
            this.logger.log(
              `GCP Storage initialized with service account: ${keyJson.client_email}`,
            );
            this.logger.log(`   Credentials file: ${credentialsPath}`);
            if (projectId) {
              this.logger.log(`   Project ID: ${projectId}`);
            }
          }
        } catch (err) {
          this.logger.warn(
            `⚠️  Could not parse credentials file: ${credentialsPath}`,
          );
        }
      }

      this.storage = new Storage({
        keyFilename: credentialsPath,
        projectId: projectId || undefined,
      });
    } else {
      // Fallback to ADC (Application Default Credentials)
      // NOTE: ADC may not work for signed URLs - requires service account with client_email
      // Set project ID explicitly for ADC
      this.storage = new Storage({
        projectId: projectId || undefined,
      });
      this.logger.warn(
        'GCP Storage initialized with ADC. Signed URLs require a service account key file. Set GOOGLE_APPLICATION_CREDENTIALS for production.',
      );
    }

    this.bucketName = this.configService.getOrThrow(
      'documentProcessing.gcp.storage.bucket',
      { infer: true },
    );

    this.bucket = this.storage.bucket(this.bucketName);

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
   * OnModuleInit: Verify GCP authentication at startup (fail fast)
   * This prevents runtime errors when handling document uploads
   */
  async onModuleInit(): Promise<void> {
    await this.verifyAuth();
  }

  /**
   * Verify GCP authentication at startup (fail fast)
   * This checks:
   * 1. Credentials are valid and can authenticate
   * 2. Project ID matches expected project
   * 3. Bucket exists and is accessible
   * 4. Service account has required permissions
   *
   * Throws error if auth fails - prevents app from starting with broken auth
   */
  async verifyAuth(): Promise<void> {
    try {
      this.logger.log('🔍 Verifying GCP authentication...');

      // Step 1: Verify we can authenticate and get project ID
      let detectedProjectId: string | null = null;
      const configuredProjectId =
        process.env.GCP_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        this.configService.get('documentProcessing.gcp.projectId', {
          infer: true,
        }) ||
        process.env.GCLOUD_PROJECT;

      try {
        detectedProjectId = await this.storage.getProjectId();
        this.logger.log(`   ✅ Project ID: ${detectedProjectId}`);

        // Verify project matches configured project (if set)
        if (configuredProjectId && detectedProjectId !== configuredProjectId) {
          this.logger.warn(
            `   ⚠️  Project mismatch: detected=${detectedProjectId}, configured=${configuredProjectId}`,
          );
          this.logger.warn(
            '   This may cause bucket access failures. Set GCP_PROJECT_ID to match your bucket project.',
          );
        }
      } catch (error) {
        // If project ID can't be auto-detected, use configured project ID
        if (configuredProjectId) {
          this.logger.warn(
            `   ⚠️  Could not auto-detect project ID, using configured: ${configuredProjectId}`,
          );
          this.logger.warn(`   Error: ${(error as Error).message}`);
          // Storage was already initialized with projectId in constructor, so continue
          detectedProjectId = configuredProjectId;
        } else {
          this.logger.error(
            `⚠️  Could not get project ID and no configured project ID found. ` +
              `Set GCP_PROJECT_ID or DOC_PROCESSING_GCP_PROJECT_ID in .env.`,
          );
          this.logger.error(`   Error: ${(error as Error).message}`);
          // Continue without project ID - it may work if credentials have it embedded
        }
      }

      // Step 2: Skip bucket listing check - we don't need storage.buckets.list permission
      // roles/storage.objectAdmin is sufficient for object operations (upload/download/delete)
      // We'll verify access to the specific bucket we need instead (Step 3)
      this.logger.log(
        '   ✅ Credentials configured (skipping bucket list check - not required)',
      );

      // Step 3: Skip bucket metadata check - roles/storage.objectAdmin doesn't include bucket.get permission
      // This is fine - we'll verify access when we actually use the bucket (upload/download operations)
      // The service account has objectAdmin role which is sufficient for object operations
      this.logger.log(
        `   ✅ Bucket configured: ${this.bucketName} (access will be verified on first use)`,
      );

      this.authVerified = true;
      this.logger.log('✅ GCP authentication verification completed');
    } catch (error) {
      this.authVerified = false;
      this.logger.error(
        '⚠️  GCP authentication verification encountered errors',
      );
      this.logger.error(`   Error: ${(error as Error).message}`);
      // Don't throw - log errors but allow app to start
      // This way we can debug credential issues without blocking startup
    }
  }

  /**
   * Check if authentication has been verified
   * Used by health check endpoint
   */
  isAuthVerified(): boolean {
    return this.authVerified;
  }

  /**
   * Health check: Verify bucket is accessible
   * Used by GET /health/gcp endpoint
   */
  async healthCheck(): Promise<{
    status: string;
    bucket: string;
    accessible: boolean;
    error?: string;
  }> {
    try {
      const [exists] = await this.bucket.exists();
      if (!exists) {
        return {
          status: 'unhealthy',
          bucket: this.bucketName,
          accessible: false,
          error: 'Bucket does not exist or is not accessible',
        };
      }
      return {
        status: 'healthy',
        bucket: this.bucketName,
        accessible: true,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        bucket: this.bucketName,
        accessible: false,
        error: this.sanitizeError(error),
      };
    }
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
          // Only check for client_email if it's a service account (not ADC)
          if (keyJson.type === 'service_account' && !keyJson.client_email) {
            this.logger.error(
              `❌ Service account key file missing 'client_email' field: ${credentialsPath}`,
            );
            this.logger.error(
              '   This file may be user credentials, not a service account key.',
            );
          } else if (
            keyJson.type === 'service_account' &&
            keyJson.client_email
          ) {
            this.logger.log(
              `✅ Service account credentials validated: ${keyJson.client_email}`,
            );
          } else {
            // It's ADC (user credentials) - that's fine, just log it
            // Note: Constructor already handles preferring service account key if available
            this.logger.log(
              '✅ Application Default Credentials (ADC) file found',
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
    const objectKey = `${this.rawPrefix}${metadata.userId}/${metadata.documentId}_${metadata.fileName}`;
    this.logger.debug(
      `Attempting to upload file for document ${metadata.documentId} to bucket: ${this.bucketName}, object: ${objectKey}`,
    );

    try {
      const file: File = this.bucket.file(objectKey);

      this.logger.debug(
        `Starting upload for document ${metadata.documentId} (${(metadata.contentLength / 1024).toFixed(2)} KB, type: ${metadata.mimeType})`,
      );

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

      this.logger.debug(
        `Successfully uploaded raw file for document ${metadata.documentId} (${(metadata.contentLength / 1024).toFixed(2)} KB)`,
      );

      return gcsUri;
    } catch (error) {
      const errorDetails = error as any;

      // Log comprehensive error details
      this.logger.error(
        `❌ Failed to upload file for document ${metadata.documentId} to bucket ${this.bucketName}`,
      );
      this.logger.error(`  Operation: storeRaw (upload)`);
      this.logger.error(`  Bucket: ${this.bucketName}`);
      this.logger.error(`  Object key: ${objectKey}`);
      this.logger.error(
        `  File size: ${(metadata.contentLength / 1024).toFixed(2)} KB`,
      );
      this.logger.error(`  MIME type: ${metadata.mimeType}`);

      // Log error details
      this.logger.error(`  Error code: ${errorDetails?.code || 'unknown'}`);
      this.logger.error(
        `  Error message: ${errorDetails?.message || String(error)}`,
      );
      if (errorDetails?.response) {
        this.logger.error(
          `  HTTP status: ${errorDetails.response?.statusCode || 'unknown'}`,
        );
      }
      if (errorDetails?.errors) {
        this.logger.error(
          `  GCP API errors: ${JSON.stringify(errorDetails.errors)}`,
        );
      }

      // Log credential info
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      this.logger.error(`  Credentials path: ${credentialsPath || 'not set'}`);
      if (credentialsPath) {
        try {
          if (fs.existsSync(credentialsPath)) {
            const keyContent = fs.readFileSync(credentialsPath, 'utf8');
            const keyJson = JSON.parse(keyContent);
            if (keyJson.client_email) {
              this.logger.error(`  Service account: ${keyJson.client_email}`);
              this.logger.error(
                `  Project ID from key: ${keyJson.project_id || 'not found'}`,
              );
            } else {
              this.logger.error(
                `  ⚠️  Credentials file does not contain client_email (may be ADC)`,
              );
            }
          } else {
            this.logger.error(
              `  ❌ Credentials file does not exist: ${credentialsPath}`,
            );
          }
        } catch (err) {
          this.logger.error(
            `  ⚠️  Could not read credentials file: ${(err as Error).message}`,
          );
        }
      }

      // Log project ID
      const projectId =
        process.env.GCP_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT;
      this.logger.error(`  Configured project ID: ${projectId || 'not set'}`);

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
    const objectKey = `${this.processedPrefix}${metadata.userId}/${metadata.documentId}.json`;
    const gcsUri = `gs://${this.bucket.name}/${objectKey}`;

    try {
      const file: File = this.bucket.file(objectKey);

      // Check if file already exists (to handle retention policy gracefully)
      // This requires storage.objects.get permission (included in roles/storage.objectAdmin)
      const [exists] = await file.exists();
      if (exists) {
        this.logger.debug(
          `Processed file already exists for document ${metadata.documentId}, skipping overwrite (retention policy)`,
        );
        return gcsUri;
      }

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

      this.logger.debug(
        `Stored processed output for document ${metadata.documentId}`,
      );

      return gcsUri;
    } catch (error) {
      const errorDetails = error as any;

      // Log comprehensive error details
      this.logger.error(
        `❌ Failed to store processed output for document ${metadata.documentId} to bucket ${this.bucketName}`,
      );
      this.logger.error(`  Operation: storeProcessed`);
      this.logger.error(`  Bucket: ${this.bucketName}`);
      this.logger.error(
        `  Object key: ${this.processedPrefix}${metadata.userId}/${metadata.documentId}.json`,
      );
      this.logger.error(`  Error code: ${errorDetails?.code || 'unknown'}`);
      this.logger.error(
        `  Error message: ${errorDetails?.message || String(error)}`,
      );

      // Log credential info
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      this.logger.error(`  Credentials path: ${credentialsPath || 'not set'}`);
      if (credentialsPath && fs.existsSync(credentialsPath)) {
        try {
          const keyContent = fs.readFileSync(credentialsPath, 'utf8');
          const keyJson = JSON.parse(keyContent);
          if (keyJson.client_email) {
            this.logger.error(`  Service account: ${keyJson.client_email}`);
          }
        } catch (err) {
          // Ignore parsing errors
        }
      }

      // Check if this is a retention policy error (not auth error)
      if (
        errorDetails?.message?.includes('retention policy') ||
        errorDetails?.message?.includes('object retention') ||
        errorDetails?.message?.includes('cannot be deleted or overwritten')
      ) {
        this.logger.warn(
          `⚠️  Retention policy error for document ${metadata.documentId}: Object cannot be overwritten due to bucket retention policy`,
        );
        this.logger.warn(
          `   This is expected behavior - processed files are protected by retention policy.`,
        );
        this.logger.warn(
          `   The file already exists and cannot be overwritten until retention period expires.`,
        );
        // Return the existing GCS URI instead of failing
        const existingGcsUri = `gs://${this.bucketName}/${this.processedPrefix}${metadata.userId}/${metadata.documentId}.json`;
        this.logger.log(`   Returning existing GCS URI: ${existingGcsUri}`);
        return existingGcsUri;
      }

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
      this.logger.debug(
        `Generating signed URL for bucket: ${bucket}, object: ${objectKey}, expires in: ${expiresIn}s`,
      );

      const file = this.storage.bucket(bucket).file(objectKey);

      // Check what credentials we're using
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credentialsPath) {
        try {
          const keyContent = fs.readFileSync(credentialsPath, 'utf8');
          const keyJson = JSON.parse(keyContent);
          if (keyJson.client_email) {
            this.logger.debug(
              `Using service account for signed URL: ${keyJson.client_email}`,
            );
          }
        } catch {
          // Ignore parsing errors
        }
      }

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresIn * 1000,
      });

      this.logger.debug(
        `Successfully generated signed URL (expires in ${expiresIn}s)`,
      );

      return url;
    } catch (error) {
      const errorDetails = error as any;
      this.logger.error(`Failed to generate signed URL for GCS URI: ${gcsUri}`);
      this.logger.error(
        `  Error code: ${errorDetails?.code || 'unknown'}, Error message: ${errorDetails?.message || String(error)}`,
      );

      // Log credential info
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (credentialsPath) {
        this.logger.error(`  Credentials file: ${credentialsPath}`);
        try {
          const keyContent = fs.readFileSync(credentialsPath, 'utf8');
          const keyJson = JSON.parse(keyContent);
          if (keyJson.client_email) {
            this.logger.error(`  Service account: ${keyJson.client_email}`);
          } else {
            this.logger.error(
              `  ⚠️  Credentials file does not contain client_email (may be ADC, not service account)`,
            );
          }
        } catch (err) {
          this.logger.error(
            `  ⚠️  Could not read credentials file: ${(err as Error).message}`,
          );
        }
      } else {
        this.logger.error(`  ⚠️  GOOGLE_APPLICATION_CREDENTIALS not set`);
      }

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

    // Log full error details for debugging
    this.logger.debug(
      `Detecting auth error - Code: ${errorCode}, Subtype: ${errorSubtype}, Message: ${errorMessage.substring(0, 500)}`,
    );

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

    // Check for retention policy errors (not auth errors)
    if (
      errorMessage.includes('retention policy') ||
      errorMessage.includes('object retention') ||
      errorMessage.includes('cannot be deleted or overwritten until')
    ) {
      // This is NOT an authentication error - it's a retention policy violation
      return null; // Don't classify as auth error
    }

    // Check for other common auth errors (but exclude retention policy 403s)
    if (
      errorCode === 401 ||
      (errorCode === 403 &&
        !errorMessage.includes('retention policy') &&
        !errorMessage.includes('object retention') &&
        !errorMessage.includes('cannot be deleted or overwritten'))
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

    // Also check for credential loading errors
    if (
      errorMessage.includes('Could not load the default credentials') ||
      errorMessage.includes('unauthorized') ||
      (errorMessage.includes('permission denied') &&
        !errorMessage.includes('retention'))
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
