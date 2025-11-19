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

    this.logger.log('GCP Document AI adapter initialized');
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
      return this.processBatch(gcsUri, mimeType);
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

      this.logger.log(
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
        this.logger.warn(
          `[GCP DOCUMENT AI] No entities in Document AI response! Falling back to regex-based extraction.`,
        );

        // Fallback: Extract entities from text using regex patterns
        const textEntities = extractEntitiesFromText(fullText);
        this.logger.log(
          `[GCP DOCUMENT AI] Fallback extraction found ${textEntities.length} entities`,
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

      // Calculate overall confidence (average of entity confidences)
      const confidence =
        entities.length > 0
          ? entities.reduce((sum, e) => sum + e.confidence, 0) / entities.length
          : 0.8; // Default if no entities

      this.logger.log(
        `[GCP DOCUMENT AI] Sync processing complete: ${entities.length} entities extracted, confidence: ${confidence.toFixed(2)}`,
      );

      return {
        text: extractedText,
        confidence,
        pageCount: doc.pages?.length || 1,
        entities,
        fullResponse: result.document, // Store full response for advanced use cases
      };
    } catch (error) {
      this.logger.error(`Sync processing failed: ${this.sanitizeError(error)}`);
      throw new Error('Document OCR processing failed');
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
      const [operation] = await this.client.batchProcessDocuments(request);

      // Poll until complete (can take minutes for large documents)
      this.logger.debug('Waiting for batch operation to complete...');
      await operation.promise();

      this.logger.debug('Batch operation complete, reading results...');

      // Read results from output GCS folder
      const results = await this.readBatchResults(outputUri);

      return results;
    } catch (error) {
      this.logger.error(
        `Batch processing failed: ${this.sanitizeError(error)}`,
      );
      throw new Error('Document OCR batch processing failed');
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

      this.logger.log(
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
        this.logger.warn(
          `[GCP DOCUMENT AI] No entities in Document AI response! Falling back to regex-based extraction.`,
        );

        // Fallback: Extract entities from text using regex patterns
        const textEntities = extractEntitiesFromText(fullText);
        this.logger.log(
          `[GCP DOCUMENT AI] Fallback extraction found ${textEntities.length} entities`,
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
          : 0.8;

      this.logger.log(
        `[GCP DOCUMENT AI] Batch results parsed: ${entities.length} entities extracted, confidence: ${confidence.toFixed(2)}`,
      );

      return {
        text: extractedText,
        confidence,
        pageCount: doc.pages?.length || 1,
        entities,
        fullResponse: result,
        outputRef: outputUri, // Store reference to full output folder
      };
    } catch (error) {
      this.logger.error(
        `Failed to read batch results: ${this.sanitizeError(error)}`,
      );
      throw new Error('Failed to read OCR results');
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
