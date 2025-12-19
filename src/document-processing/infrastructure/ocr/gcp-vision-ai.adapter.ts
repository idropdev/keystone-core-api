import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { Storage } from '@google-cloud/storage';
import { OcrServicePort, OcrResult } from '../../domain/ports/ocr.service.port';
import { AllConfigType } from '../../../config/config.type';
import { extractEntitiesFromText } from '../../utils/text-entity-extractor';

/**
 * GCP Vision AI Adapter
 *
 * Supports both synchronous and asynchronous batch processing:
 * - Synchronous: For images (PNG, JPG, WEBP)
 * - Asynchronous batch: For PDF/TIFF documents
 *
 * Uses DOCUMENT_TEXT_DETECTION feature for OCR.
 *
 * HIPAA Compliance:
 * - Google Vision AI is HIPAA-eligible (BAA required)
 * - Processing happens in GCP with encryption in transit
 * - Results stored in GCS with encryption at rest
 * - Never log PHI or full document text
 *
 * IAM Requirements:
 * - Service account needs: roles/cloudvision.apiUser
 * - For batch: roles/storage.objectCreator on output bucket
 */
@Injectable()
export class GcpVisionAiAdapter implements OcrServicePort {
  private readonly logger = new Logger(GcpVisionAiAdapter.name);
  private readonly client: ImageAnnotatorClient;
  private readonly storage: Storage;
  private readonly projectId: string;
  private readonly outputBucket: string;
  private readonly outputPrefix: string;
  private readonly maxWaitTime: number = 600000; // 10 minutes

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.client = new ImageAnnotatorClient();
    this.storage = new Storage();

    this.projectId = this.configService.getOrThrow(
      'documentProcessing.gcp.projectId',
      { infer: true },
    );

    this.outputBucket = this.configService.getOrThrow(
      'documentProcessing.gcp.storage.bucket',
      { infer: true },
    );

    this.outputPrefix =
      this.configService.get('documentProcessing.gcp.visionAi.asyncOutputPrefix', {
        infer: true,
      }) || 'vision-ocr-output/';

    this.logger.log(
      `[VISION AI] Adapter initialized - Project: ${this.projectId}, Bucket: ${this.outputBucket}, Prefix: ${this.outputPrefix}`,
    );
  }

  async processDocument(
    gcsUri: string,
    mimeType: string,
    pageCount?: number,
  ): Promise<OcrResult> {
    this.logger.log(
      `[VISION AI] processDocument called - MIME: ${mimeType}, PageCount: ${pageCount || 'unknown'}, URI: ${this.sanitizeGcsUri(gcsUri)}`,
    );

    // Route by MIME type
    if (this.isImageMimeType(mimeType)) {
      this.logger.log(`[VISION AI] Routing to synchronous processing (image)`);
      return this.processSync(gcsUri, mimeType);
    } else {
      this.logger.log(`[VISION AI] Routing to async batch processing (PDF/TIFF)`);
      return this.processBatch(gcsUri, mimeType);
    }
  }

  /**
   * Synchronous processing for images (PNG, JPG, WEBP)
   */
  private async processSync(
    gcsUri: string,
    mimeType: string,
  ): Promise<OcrResult> {
    const startTime = Date.now();
    this.logger.log(
      `[VISION AI SYNC] Starting sync processing - MIME: ${mimeType}, URI: ${this.sanitizeGcsUri(gcsUri)}`,
    );

    try {
      const request = {
        requests: [
          {
            image: {
              source: {
                gcsImageUri: gcsUri,
              },
            },
            features: [
              {
                type: 'DOCUMENT_TEXT_DETECTION' as const,
              },
            ],
          },
        ],
      };

      this.logger.debug(`[VISION AI SYNC] Calling batchAnnotateImages API`);
      const [response] = await this.client.batchAnnotateImages(request);
      this.logger.debug(
        `[VISION AI SYNC] API call completed - Response count: ${response.responses?.length || 0}`,
      );

      const result = response.responses?.[0];

      if (!result) {
        this.logger.error(`[VISION AI SYNC] No response in API result`);
        throw new Error('No response returned from Vision AI');
      }

      if (!result.fullTextAnnotation) {
        this.logger.error(`[VISION AI SYNC] No fullTextAnnotation in response`);
        throw new Error('No fullTextAnnotation returned from Vision AI');
      }

      this.logger.debug(`[VISION AI SYNC] fullTextAnnotation found, extracting text`);
      const fullTextAnnotation = result.fullTextAnnotation;
      const fullText = fullTextAnnotation.text || '';
      const extractedText = fullText.substring(0, 5000);

      // Extract page count
      const pageCount = fullTextAnnotation.pages?.length || 1;

      this.logger.log(
        `[VISION AI SYNC] Text extracted - Pages: ${pageCount}, Full text length: ${fullText.length}, Extracted length: ${extractedText.length}`,
      );

      // Extract entities using fallback regex (Vision AI doesn't provide structured entities)
      this.logger.debug(`[VISION AI SYNC] Extracting entities from text`);
      const entities = extractEntitiesFromText(fullText);

      // Calculate confidence (Vision AI doesn't provide overall confidence, use default)
      const confidence = 0.85; // Default confidence for Vision AI

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `[VISION AI SYNC] Processing complete - Entities: ${entities.length}, Confidence: ${confidence}, Time: ${processingTime}ms`,
      );

      return {
        text: extractedText,
        confidence,
        pageCount,
        entities,
        fullResponse: {
          fullTextAnnotation,
        },
      };
    } catch (error) {
      this.logger.error(`Sync processing failed: ${this.sanitizeError(error)}`);
      throw new Error('Vision AI OCR processing failed');
    }
  }

  /**
   * Asynchronous batch processing for PDF/TIFF
   */
  private async processBatch(
    gcsUri: string,
    mimeType: string,
  ): Promise<OcrResult> {
    const startTime = Date.now();
    this.logger.log(
      `[VISION AI BATCH] Starting batch processing - MIME: ${mimeType}, URI: ${this.sanitizeGcsUri(gcsUri)}`,
    );

    try {
      // Extract document ID from GCS URI for output folder
      const documentId = this.extractDocumentIdFromUri(gcsUri);
      const runId = Date.now().toString();
      const outputUri = `gs://${this.outputBucket}/${this.outputPrefix}${documentId}/${runId}/`;

      this.logger.log(
        `[VISION AI BATCH] Document ID: ${documentId}, Run ID: ${runId}, Output URI: ${this.sanitizeGcsUri(outputUri)}`,
      );

      const request = {
        requests: [
          {
            inputConfig: {
              gcsSource: {
                uri: gcsUri,
              },
              mimeType,
            },
            outputConfig: {
              gcsDestination: {
                uri: outputUri,
              },
            },
            features: [
              {
                type: 'DOCUMENT_TEXT_DETECTION' as const,
              },
            ],
          },
        ],
      };

      this.logger.debug(`[VISION AI BATCH] Calling asyncBatchAnnotateFiles API`);
      // Start batch operation
      const operationResult = await this.client.asyncBatchAnnotateFiles(request);
      const operation = operationResult[0];
      this.logger.log(
        `[VISION AI BATCH] Batch operation started - Operation name: ${operation.name || 'unknown'}`,
      );

      // Wait for operation to complete
      this.logger.log(`[VISION AI BATCH] Waiting for operation to complete (max ${this.maxWaitTime / 1000}s)...`);
      const waitStartTime = Date.now();

      // Set timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('Batch operation timeout exceeded')),
          this.maxWaitTime,
        );
      });

      // Wait for operation with timeout
      await Promise.race([operation.promise(), timeoutPromise]);

      const waitTime = Date.now() - waitStartTime;
      this.logger.log(
        `[VISION AI BATCH] Operation completed - Wait time: ${waitTime}ms, Reading results from GCS...`,
      );

      // Read results from output GCS folder
      const results = await this.readBatchResults(outputUri);

      const totalTime = Date.now() - startTime;
      this.logger.log(
        `[VISION AI BATCH] Batch processing complete - Total time: ${totalTime}ms`,
      );

      return results;
    } catch (error) {
      this.logger.error(
        `Batch processing failed: ${this.sanitizeError(error)}`,
      );
      throw new Error('Vision AI OCR batch processing failed');
    }
  }

  /**
   * Read batch processing results from GCS
   */
  private async readBatchResults(outputUri: string): Promise<OcrResult> {
    this.logger.log(
      `[VISION AI BATCH] Reading results from: ${this.sanitizeGcsUri(outputUri)}`,
    );

    try {
      // Parse output URI: gs://bucket/path/
      const bucketName = outputUri.replace('gs://', '').split('/')[0];
      const prefix = outputUri.replace(`gs://${bucketName}/`, '');

      this.logger.debug(
        `[VISION AI BATCH] Parsed URI - Bucket: ${bucketName}, Prefix: ${prefix}`,
      );

      const bucket = this.storage.bucket(bucketName);
      this.logger.debug(`[VISION AI BATCH] Listing files in bucket with prefix`);
      const [files] = await bucket.getFiles({ prefix });

      this.logger.log(
        `[VISION AI BATCH] Found ${files.length} files in output folder`,
      );

      // Find first result JSON file (exclude operation.json)
      const resultFile = files.find(
        (file) =>
          file.name.endsWith('.json') && !file.name.endsWith('operation.json'),
      );

      if (!resultFile) {
        this.logger.error(
          `[VISION AI BATCH] No result JSON file found. Available files: ${files.map((f) => f.name).join(', ')}`,
        );
        throw new Error('Batch result file not found in output folder');
      }

      this.logger.log(
        `[VISION AI BATCH] Found result file: ${resultFile.name}, Downloading...`,
      );
      const [content] = await resultFile.download();
      this.logger.debug(
        `[VISION AI BATCH] File downloaded - Size: ${content.length} bytes, Parsing JSON...`,
      );
      const result = JSON.parse(content.toString());

      // Extract fullTextAnnotation from result
      const responses = result.responses || [];
      this.logger.debug(
        `[VISION AI BATCH] Parsed JSON - Response count: ${responses.length}`,
      );

      if (responses.length === 0) {
        this.logger.error(`[VISION AI BATCH] No responses in batch result JSON`);
        throw new Error('No responses in batch result');
      }

      // Use first response (for multi-page documents, responses may be split)
      const firstResponse = responses[0];
      const fullTextAnnotation = firstResponse.fullTextAnnotation;

      if (!fullTextAnnotation) {
        this.logger.error(
          `[VISION AI BATCH] No fullTextAnnotation in first response`,
        );
        throw new Error('No fullTextAnnotation in batch result');
      }

      this.logger.debug(`[VISION AI BATCH] fullTextAnnotation found, extracting text`);
      const fullText = fullTextAnnotation.text || '';
      const extractedText = fullText.substring(0, 5000);
      const pageCount = fullTextAnnotation.pages?.length || 1;

      this.logger.log(
        `[VISION AI BATCH] Text extracted - Pages: ${pageCount}, Full text length: ${fullText.length}, Extracted length: ${extractedText.length}`,
      );

      // Extract entities using fallback regex
      this.logger.debug(`[VISION AI BATCH] Extracting entities from text`);
      const entities = extractEntitiesFromText(fullText);

      const confidence = 0.85; // Default confidence

      this.logger.log(
        `[VISION AI BATCH] Results parsed - Entities: ${entities.length}, Confidence: ${confidence}`,
      );

      return {
        text: extractedText,
        confidence,
        pageCount,
        entities,
        fullResponse: {
          fullTextAnnotation,
        },
        outputRef: outputUri,
      };
    } catch (error) {
      this.logger.error(
        `Failed to read batch results: ${this.sanitizeError(error)}`,
      );
      throw new Error('Failed to read Vision AI OCR results');
    }
  }

  /**
   * Check if MIME type is an image (synchronous processing)
   */
  private isImageMimeType(mimeType: string): boolean {
    return (
      mimeType === 'image/png' ||
      mimeType === 'image/jpeg' ||
      mimeType === 'image/jpg' ||
      mimeType === 'image/webp'
    );
  }

  /**
   * Extract document ID from GCS URI
   * Example: gs://bucket/raw/user123/doc456_file.pdf -> doc456
   */
  private extractDocumentIdFromUri(gcsUri: string): string {
    const parts = gcsUri.split('/');
    const filename = parts[parts.length - 1];
    // Assume format: {documentId}_{originalFilename}
    return filename.split('_')[0] || 'unknown';
  }

  /**
   * Sanitize error messages (no PHI)
   */
  private sanitizeError(error: any): string {
    const message = error?.message || String(error);
    return message
      .replace(/gs:\/\/[^\s]+/g, '[GCS_URI_REDACTED]')
      .replace(/projects\/[^\/\s]+/g, 'projects/[PROJECT_REDACTED]')
      .substring(0, 200);
  }

  /**
   * Sanitize GCS URI for logging (no PHI)
   */
  private sanitizeGcsUri(gcsUri: string): string {
    // Show bucket and last part of path only
    const parts = gcsUri.replace('gs://', '').split('/');
    if (parts.length > 0) {
      const bucket = parts[0];
      const filename = parts[parts.length - 1];
      return `gs://${bucket}/.../${filename}`;
    }
    return '[GCS_URI_REDACTED]';
  }
}

