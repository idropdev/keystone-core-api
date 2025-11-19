import { Injectable, Logger } from '@nestjs/common';
import { OcrServicePort, OcrResult } from '../../domain/ports/ocr.service.port';
import { analyzePdf } from '../../utils/pdf-analyzer';

/**
 * PDF Direct Text Extractor
 *
 * Extracts text directly from text-based PDFs without OCR.
 *
 * Advantages:
 * - ✅ Much faster than OCR (milliseconds vs seconds)
 * - ✅ More accurate (native text, no OCR errors)
 * - ✅ Cost-effective (no Document AI API calls)
 *
 * Limitations:
 * - ❌ Only works for text-based PDFs (not scanned documents)
 * - ❌ No entity extraction (no NER/structured field detection)
 * - ❌ No form field recognition
 *
 * Use cases:
 * - Digital lab results
 * - Electronic prescriptions
 * - Computer-generated medical reports
 */
@Injectable()
export class PdfDirectExtractorAdapter implements OcrServicePort {
  private readonly logger = new Logger(PdfDirectExtractorAdapter.name);

  async processDocument(
    gcsUriOrBuffer: string | Buffer,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _mimeType: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _pageCount?: number,
  ): Promise<OcrResult> {
    try {
      // If GCS URI provided, we can't process directly
      // This adapter expects a buffer
      if (typeof gcsUriOrBuffer === 'string') {
        throw new Error(
          'PDF direct extraction requires buffer, not GCS URI. Use OCR adapter for GCS files.',
        );
      }

      const buffer = gcsUriOrBuffer;

      // Analyze and extract
      const analysis = await analyzePdf(buffer);

      if (!analysis.isTextBased) {
        throw new Error(
          'PDF does not contain extractable text. Use OCR instead.',
        );
      }

      this.logger.debug(
        `Direct extraction complete: ${analysis.pageCount} pages, ${analysis.charCount} characters`,
      );

      // Return in OCR format for consistency
      return {
        text: analysis.extractedText,
        confidence: 1.0, // Native text = 100% confidence
        pageCount: analysis.pageCount,
        entities: [], // No entity extraction in direct mode
        fullResponse: {
          method: 'direct_extraction',
          metadata: analysis.metadata,
        },
      };
    } catch (error) {
      this.logger.error(`Direct extraction failed: ${error.message}`);
      throw error; // Let caller fall back to OCR
    }
  }
}
