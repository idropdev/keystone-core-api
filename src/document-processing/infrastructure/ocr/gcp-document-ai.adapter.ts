import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { Storage } from '@google-cloud/storage';
import { OcrServicePort, OcrResult } from '../../domain/ports/ocr.service.port';
import { AllConfigType } from '../../../config/config.type';
import { extractEntitiesFromText } from '../../utils/text-entity-extractor';

/**
 * GCP Document AI Adapter
 *
 * Supports both online (synchronous) and batch (asynchronous) processing:
 * - Online: For documents <= syncMaxPages (e.g., 15 pages)
 * - Batch: For larger documents or when page count unknown
 *
 * HIPAA Compliance:
 * - Google Document AI is HIPAA-eligible (BAA required)
 * - Processing happens in GCP with encryption in transit
 * - Results stored in GCS with encryption at rest
 * - Never log PHI or full document text
 *
 * IAM Requirements:
 * - Service account needs: roles/documentai.apiUser
 * - For batch: roles/storage.objectCreator on output bucket
 *
 * TODO: Sign Business Associate Agreement (BAA) with Google for HIPAA compliance
 * TODO: Configure processor type (Enterprise Document OCR recommended for medical documents)
 * TODO: Enable audit logging on Document AI API
 */
@Injectable()
export class GcpDocumentAiAdapter implements OcrServicePort {
  private readonly logger = new Logger(GcpDocumentAiAdapter.name);
  private readonly client: DocumentProcessorServiceClient;
  private readonly storage: Storage;
  private readonly projectId: string;
  private readonly location: string;
  private readonly processorId: string;
  private readonly outputBucket: string;
  private readonly syncMaxPages: number;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    // TODO: Use Workload Identity or service account key
    this.client = new DocumentProcessorServiceClient();
    this.storage = new Storage();

    this.projectId = this.configService.getOrThrow(
      'documentProcessing.gcp.projectId',
      { infer: true },
    );

    this.location = this.configService.getOrThrow(
      'documentProcessing.gcp.documentAi.location',
      { infer: true },
    );

    this.processorId = this.configService.getOrThrow(
      'documentProcessing.gcp.documentAi.processorId',
      { infer: true },
    );

    this.outputBucket = this.configService.getOrThrow(
      'documentProcessing.gcp.documentAi.outputBucket',
      { infer: true },
    );

    this.syncMaxPages = this.configService.getOrThrow(
      'documentProcessing.syncMaxPages',
      { infer: true },
    );

    this.logger.log(
      `GCP Document AI adapter initialized with processor: projects/${this.projectId}/locations/${this.location}/processors/${this.processorId}`,
    );
    this.logger.log(
      'NOTE: Text extraction is primary focus. Entity extraction will be implemented later.',
    );
  }

  async processDocument(
    gcsUri: string,
    mimeType: string,
    pageCount?: number,
  ): Promise<OcrResult> {
    // Decide processing mode
    const useSync = this.shouldUseSyncMode(mimeType, pageCount);

    if (useSync) {
      this.logger.debug(`Using synchronous processing for ${gcsUri}`);
      return this.processSync(gcsUri, mimeType);
    } else {
      this.logger.debug(`Using batch processing for ${gcsUri}`);
      try {
        return await this.processBatch(gcsUri, mimeType);
      } catch (batchError: any) {
        // If batch fails and we don't know page count, try sync as fallback
        // (batch might fail due to configuration, but sync might work)
        if (pageCount === undefined) {
          this.logger.warn(
            `Batch processing failed, falling back to sync mode: ${this.sanitizeError(batchError).substring(0, 100)}`,
          );
          this.logger.debug(
            `Attempting sync processing as fallback for ${gcsUri}`,
          );
          try {
            return await this.processSync(gcsUri, mimeType);
          } catch (syncError: any) {
            // If sync also fails, throw original batch error with context
            this.logger.error(
              `Both batch and sync processing failed. Batch error: ${this.sanitizeError(batchError).substring(0, 100)}`,
            );
            throw batchError; // Throw original batch error
          }
        } else {
          // If we know page count and it's > syncMaxPages, batch is required
          throw batchError;
        }
      }
    }
  }

  /**
   * Online (synchronous) processing for small documents
   */
  private async processSync(
    gcsUri: string,
    mimeType: string,
  ): Promise<OcrResult> {
    try {
      const processorName = `projects/${this.projectId}/locations/${this.location}/processors/${this.processorId}`;

      const request = {
        name: processorName,
        // Using GCS input (recommended for files > 20MB)
        gcsDocument: {
          gcsUri,
          mimeType,
        },
      };

      const [result] = await this.client.processDocument(request);

      if (!result.document) {
        throw new Error('No document returned from Document AI');
      }

      const doc = result.document;

      // Extract text (limit to 5000 chars for database storage)
      const fullText = doc.text || '';
      const extractedText = fullText.substring(0, 5000);

      // Validate that we got text
      if (!fullText || fullText.trim().length === 0) {
        this.logger.warn(
          `[GCP DOCUMENT AI] No text extracted from document. This may indicate:`,
        );
        this.logger.warn(`  1. Document is image-only with no text layer`);
        this.logger.warn(`  2. OCR processing failed silently`);
        this.logger.warn(`  3. Document format is not supported`);
      } else {
        this.logger.log(
          `[GCP DOCUMENT AI] Successfully extracted ${fullText.length} characters of text (storing first ${extractedText.length} chars)`,
        );
      }

      this.logger.debug(
        `[GCP DOCUMENT AI] Sync result structure: ${JSON.stringify({
          hasEntities: !!doc.entities,
          entitiesCount: doc.entities?.length || 0,
          hasText: !!doc.text,
          textLength: doc.text?.length || 0,
          hasPages: !!doc.pages,
          pageCount: doc.pages?.length || 0,
        })}`,
      );

      let entities: any[] = [];

      if (!doc.entities || doc.entities.length === 0) {
        // Entity extraction is not implemented yet - this is expected
        // For now, just extract text and use regex-based entity extraction as fallback
        this.logger.debug(
          `[GCP DOCUMENT AI] No entities in response (expected - entity extraction to be implemented later). Using regex-based extraction from text.`,
        );

        // Fallback: Extract entities from text using regex patterns
        const textEntities = extractEntitiesFromText(fullText);
        this.logger.debug(
          `[GCP DOCUMENT AI] Regex extraction found ${textEntities.length} entities from text`,
        );
        entities = textEntities;
      } else {
        // Extract entities with high confidence from Document AI
        entities = (doc.entities || [])
          .filter((entity) => (entity.confidence || 0) >= 0.5)
          .map((entity) => ({
            type: entity.type || 'unknown',
            mentionText: entity.mentionText || '',
            confidence: entity.confidence || 0,
            startOffset: entity.textAnchor?.textSegments?.[0]?.startIndex
              ? parseInt(
                  entity.textAnchor.textSegments[0].startIndex as any,
                  10,
                )
              : undefined,
            endOffset: entity.textAnchor?.textSegments?.[0]?.endIndex
              ? parseInt(entity.textAnchor.textSegments[0].endIndex as any, 10)
              : undefined,
          }));
      }

      // Calculate overall confidence (average of entity confidences, or default based on text quality)
      const confidence =
        entities.length > 0
          ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
          : fullText.length > 0
            ? 0.8
            : 0.0; // Default confidence if text extracted, 0 if no text

      this.logger.log(
        `[GCP DOCUMENT AI] Sync processing complete: ${fullText.length} chars of text extracted, ${entities.length} entities (via regex), confidence: ${confidence.toFixed(2)}`,
      );

      return {
        text: extractedText,
        confidence,
        pageCount: doc.pages?.length || 1,
        entities,
        fullResponse: result.document, // Store full response for advanced use cases
      };
    } catch (error: any) {
      const errorMessage = this.sanitizeError(error);
      this.logger.error(`Sync processing failed: ${errorMessage}`);

      // Provide more specific error messages for common issues
      if (errorMessage.includes('NOT_FOUND')) {
        throw new Error(
          'GCP Document AI processor not found. Please verify processor ID and project configuration.',
        );
      }
      if (errorMessage.includes('PERMISSION_DENIED')) {
        throw new Error(
          'GCP Document AI permission denied. Please verify service account permissions.',
        );
      }
      if (errorMessage.includes('INVALID_ARGUMENT')) {
        throw new Error(
          'Invalid document format or GCS URI. Please verify document file and GCS configuration.',
        );
      }

      throw new Error(
        `Document OCR processing failed: ${errorMessage.substring(0, 150)}`,
      );
    }
  }

  /**
   * Batch (asynchronous) processing for large documents
   */
  private async processBatch(
    gcsUri: string,
    mimeType: string,
  ): Promise<OcrResult> {
    try {
      const processorName = `projects/${this.projectId}/locations/${this.location}/processors/${this.processorId}`;

      // Extract document ID from GCS URI for output folder
      const documentId = this.extractDocumentIdFromUri(gcsUri);
      const outputUri = `gs://${this.outputBucket}/output/${documentId}/`;

      const request = {
        name: processorName,
        inputDocuments: {
          gcsDocuments: {
            documents: [
              {
                gcsUri,
                mimeType,
              },
            ],
          },
        },
        documentOutputConfig: {
          gcsOutputConfig: {
            gcsUri: outputUri,
          },
        },
      };

      this.logger.debug(`Starting batch processing, output: ${outputUri}`);

      // Start batch operation (Long Running Operation)
      let operation;
      try {
        [operation] = await this.client.batchProcessDocuments(request);
      } catch (requestError: any) {
        const errorMessage = this.sanitizeError(requestError);
        this.logger.error(
          `Failed to start batch processing request: ${errorMessage}`,
        );

        // Provide specific error messages
        if (errorMessage.includes('NOT_FOUND')) {
          throw new Error(
            'GCP Document AI processor not found. Please verify processor ID and project configuration.',
          );
        }
        if (errorMessage.includes('PERMISSION_DENIED')) {
          throw new Error(
            'GCP Document AI permission denied. Please verify service account has roles/documentai.apiUser role.',
          );
        }
        if (errorMessage.includes('INVALID_ARGUMENT')) {
          throw new Error(
            'Invalid batch processing request. Please verify GCS URIs and document format.',
          );
        }

        throw new Error(
          `Failed to start batch processing: ${errorMessage.substring(0, 150)}`,
        );
      }

      // Poll until complete (can take minutes for large documents)
      this.logger.debug('Waiting for batch operation to complete...');

      try {
        const [result] = await operation.promise();

        // Check if operation completed with errors
        if (result?.error) {
          const errorDetails = result.error;
          const errorMessage = this.sanitizeError(errorDetails);
          this.logger.error(
            `Batch operation completed with error: ${errorMessage}`,
          );
          this.logger.error(
            `Error details: ${JSON.stringify({
              code: errorDetails.code,
              message: errorDetails.message?.substring(0, 200),
              details: errorDetails.details?.[0]?.toString().substring(0, 200),
            })}`,
          );

          // Extract specific error codes if available
          if (errorDetails.code) {
            if (errorDetails.code === 5) {
              // NOT_FOUND
              throw new Error(
                `GCP Document AI processor not found: projects/${this.projectId}/locations/${this.location}/processors/${this.processorId}. Please verify processor ID exists and is accessible.`,
              );
            }
            if (errorDetails.code === 7) {
              // PERMISSION_DENIED
              throw new Error(
                'GCP Document AI permission denied. Please verify service account has roles/documentai.apiUser and roles/storage.objectCreator roles.',
              );
            }
            if (errorDetails.code === 3) {
              // INVALID_ARGUMENT
              throw new Error(
                `Invalid batch processing request. GCS URI: ${gcsUri.substring(0, 100)}... Please verify GCS URI is accessible and document format is supported.`,
              );
            }
          }

          throw new Error(
            `Batch processing failed (code: ${errorDetails.code || 'unknown'}): ${errorMessage.substring(0, 200)}`,
          );
        }

        // Check for partial failures in result
        if (result?.response?.status?.partialFailures?.length > 0) {
          const failures = result.response.status.partialFailures;
          this.logger.warn(
            `Batch operation completed with ${failures.length} partial failure(s)`,
          );
          // Continue processing - partial failures might not be critical
        }
      } catch (operationError: any) {
        // Handle promise rejection (operation failed to complete)
        const errorMessage = this.sanitizeError(operationError);
        this.logger.error(`Batch operation promise rejected: ${errorMessage}`);

        // Check if it's a known error
        if (
          errorMessage.includes('NOT_FOUND') ||
          errorMessage.includes('not found')
        ) {
          throw new Error(
            'GCP Document AI processor not found. Please verify processor ID and project configuration.',
          );
        }
        if (
          errorMessage.includes('PERMISSION_DENIED') ||
          errorMessage.includes('permission denied')
        ) {
          throw new Error(
            'GCP Document AI permission denied. Please verify service account has roles/documentai.apiUser role.',
          );
        }
        if (
          errorMessage.includes('INVALID_ARGUMENT') ||
          errorMessage.includes('invalid')
        ) {
          throw new Error(
            'Invalid batch processing request. Please verify GCS URIs and document format.',
          );
        }

        throw new Error(
          `Batch processing operation failed: ${errorMessage.substring(0, 200)}`,
        );
      }

      this.logger.debug('Batch operation complete, reading results...');

      // Read results from output GCS folder
      const results = await this.readBatchResults(outputUri);

      return results;
    } catch (error: any) {
      const errorMessage = this.sanitizeError(error);

      // Don't log the same error twice if it was already logged
      if (
        !errorMessage.includes('GCP Document AI configuration error') &&
        !errorMessage.includes('Batch processing operation failed')
      ) {
        this.logger.error(`Batch processing failed: ${errorMessage}`);
      }

      // Re-throw with more context if it's not already a descriptive error
      if (error instanceof Error && error.message.includes('GCP Document AI')) {
        throw error;
      }

      throw new Error(
        `Document OCR batch processing failed: ${errorMessage.substring(0, 150)}`,
      );
    }
  }

  /**
   * Read batch processing results from GCS
   */
  private async readBatchResults(outputUri: string): Promise<OcrResult> {
    try {
      // Parse output URI: gs://bucket/path/
      const bucketName = outputUri.replace('gs://', '').split('/')[0];
      const prefix = outputUri.replace(`gs://${bucketName}/`, '');

      const bucket = this.storage.bucket(bucketName);
      const [files] = await bucket.getFiles({ prefix });

      // Find first result file (usually named like '0.json')
      const resultFile = files.find(
        (file) =>
          file.name.endsWith('.json') && !file.name.endsWith('operation.json'),
      );

      if (!resultFile) {
        throw new Error('Batch result file not found in output folder');
      }

      const [content] = await resultFile.download();
      const result = JSON.parse(content.toString());

      // Same parsing logic as sync mode
      const doc = result;
      const fullText = doc.text || '';
      const extractedText = fullText.substring(0, 5000);

      // Validate that we got text
      if (!fullText || fullText.trim().length === 0) {
        this.logger.warn(
          `[GCP DOCUMENT AI] No text extracted from document. This may indicate:`,
        );
        this.logger.warn(`  1. Document is image-only with no text layer`);
        this.logger.warn(`  2. OCR processing failed silently`);
        this.logger.warn(`  3. Document format is not supported`);
      } else {
        this.logger.log(
          `[GCP DOCUMENT AI] Successfully extracted ${fullText.length} characters of text (storing first ${extractedText.length} chars)`,
        );
      }

      this.logger.debug(
        `[GCP DOCUMENT AI] Batch result structure: ${JSON.stringify({
          hasEntities: !!doc.entities,
          entitiesCount: doc.entities?.length || 0,
          hasText: !!doc.text,
          textLength: doc.text?.length || 0,
          hasPages: !!doc.pages,
          pageCount: doc.pages?.length || 0,
          topLevelKeys: Object.keys(doc),
        })}`,
      );

      let entities: any[] = [];

      if (!doc.entities || doc.entities.length === 0) {
        // Entity extraction is not implemented yet - this is expected
        // For now, just extract text and use regex-based entity extraction as fallback
        this.logger.debug(
          `[GCP DOCUMENT AI] No entities in response (expected - entity extraction to be implemented later). Using regex-based extraction from text.`,
        );

        // Fallback: Extract entities from text using regex patterns
        const textEntities = extractEntitiesFromText(fullText);
        this.logger.debug(
          `[GCP DOCUMENT AI] Regex extraction found ${textEntities.length} entities from text`,
        );
        entities = textEntities;
      } else {
        // Extract entities with high confidence from Document AI
        entities = (doc.entities || [])
          .filter((entity: any) => (entity.confidence || 0) >= 0.5)
          .map((entity: any) => ({
            type: entity.type || 'unknown',
            mentionText: entity.mentionText || '',
            confidence: entity.confidence || 0,
            startOffset: entity.textAnchor?.textSegments?.[0]?.startIndex,
            endOffset: entity.textAnchor?.textSegments?.[0]?.endIndex,
          }));
      }

      const confidence =
        entities.length > 0
          ? entities.reduce((sum: number, e: any) => sum + e.confidence, 0) /
            entities.length
          : fullText.length > 0
            ? 0.8
            : 0.0; // Default confidence if text extracted, 0 if no text

      this.logger.log(
        `[GCP DOCUMENT AI] Batch results parsed: ${fullText.length} chars of text extracted, ${entities.length} entities (via regex), confidence: ${confidence.toFixed(2)}`,
      );

      return {
        text: extractedText,
        confidence,
        pageCount: doc.pages?.length || 1,
        entities,
        fullResponse: result,
        outputRef: outputUri, // Store reference to full output folder
      };
    } catch (error: any) {
      const errorMessage = this.sanitizeError(error);
      this.logger.error(`Failed to read batch results: ${errorMessage}`);

      // Provide more specific error messages
      if (
        errorMessage.includes('not found') ||
        errorMessage.includes('NOT_FOUND')
      ) {
        throw new Error(
          'Batch processing result file not found. The batch operation may have failed or results may not be ready yet.',
        );
      }
      if (errorMessage.includes('PERMISSION_DENIED')) {
        throw new Error(
          'Permission denied reading batch results from GCS. Please verify service account has storage.objectViewer role.',
        );
      }

      throw new Error(
        `Failed to read OCR results: ${errorMessage.substring(0, 150)}`,
      );
    }
  }

  /**
   * Determine if sync or batch mode should be used
   */
  private shouldUseSyncMode(mimeType: string, pageCount?: number): boolean {
    // If page count known and within limit, use sync
    if (pageCount !== undefined && pageCount > 0) {
      return pageCount <= this.syncMaxPages;
    }

    // Default heuristics based on MIME type
    if (mimeType.startsWith('image/')) {
      // Images are usually single-page, use sync
      return true;
    }

    // For PDFs with unknown page count, default to batch (safer)
    return false;
  }

  /**
   * Extract document ID from GCS URI
   * Example: gs://bucket/raw/user123/doc456_file.pdf -> doc456
   */
  private extractDocumentIdFromUri(gcsUri: string): string {
    const parts = gcsUri.split('/');
    const filename = parts[parts.length - 1];
    // Assume format: {documentId}_{originalFilename}
    return filename.split('_')[0];
  }

  /**
   * Sanitize error messages
   */
  private sanitizeError(error: any): string {
    const message = error?.message || String(error);
    return message
      .replace(/gs:\/\/[^\s]+/g, '[GCS_URI_REDACTED]')
      .replace(/projects\/[^\/\s]+/g, 'projects/[PROJECT_REDACTED]')
      .substring(0, 200);
  }
}
