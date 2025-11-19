import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage, Bucket, File } from '@google-cloud/storage';
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
    // TODO: In production, use Workload Identity (GKE) or service account key
    // GOOGLE_APPLICATION_CREDENTIALS env var should point to key file
    this.storage = new Storage();

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
    // TODO: Verify bucket exists and is accessible on startup
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
      this.logger.error(
        `Failed to generate signed URL: ${this.sanitizeError(error)}`,
      );
      throw new Error('Failed to generate download URL');
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
