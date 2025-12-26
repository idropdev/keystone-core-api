import { Injectable, Logger } from '@nestjs/common';

// Use require to get the correct constructor reference
// pdf2json exports a class/constructor, not a plain function
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFParserModule = require('pdf2json');

/**
 * PDF2JSON Extraction Service
 *
 * Extracts text and form fields from PDF files using pdf2json library.
 * This library transforms PDF files from binary to JSON format, using pdf.js for its core functionality.
 *
 * Key features:
 * - Extracts text content from PDF pages
 * - Extracts interactive form field values
 * - Returns structured chunks (pages and fields)
 * - Includes metadata from the PDF
 *
 * Usage pattern from docs:
 * - const PDFParser = require("pdf2json");
 * - const pdfParser = new PDFParser();
 * - pdfParser.parseBuffer(buffer);
 *
 * @see https://github.com/modesty/pdf2json
 * @see https://www.npmjs.com/package/pdf2json
 */
@Injectable()
export class Pdf2JsonService {
  private readonly logger = new Logger(Pdf2JsonService.name);

  /**
   * Parse a PDF buffer and extract structured content
   *
   * @param buffer - PDF file buffer
   * @returns Object containing chunks (array of text/field content) and metadata
   */
  async parseBuffer(buffer: Buffer): Promise<{
    chunks: Array<{ id: string; content: string }>;
    meta: any;
  }> {
    this.logger.log('[PDF2JSON] Starting parse of PDF buffer...');

    // Debug: Log buffer info
    this.logger.debug(
      `[PDF2JSON] Buffer size: ${buffer.length} bytes, First 10 bytes (hex): ${buffer.slice(0, 10).toString('hex')}`,
    );

    // Get the correct constructor: PDFParser class
    // pdf2json may export either PDFParserModule.PDFParser or PDFParserModule directly
    const PDFParserCtor = PDFParserModule.PDFParser || PDFParserModule;

    // Debug: Verify we have a constructor
    this.logger.debug(`[PDF2JSON] PDFParserCtor type: ${typeof PDFParserCtor}`);

    if (typeof PDFParserCtor !== 'function') {
      this.logger.error(
        `[PDF2JSON] PDFParserCtor is not a constructor! Type: ${typeof PDFParserCtor}`,
      );
      throw new Error(
        'pdf2json PDFParser constructor not found - check import',
      );
    }

    // Create parser instance using the constructor
    const pdfParser: any = new PDFParserCtor();

    // Suppress pdf2json library's console.error output (it prints verbose stack traces)
    // We'll handle errors through our own logging
    const originalConsoleError = console.error;
    const suppressedErrors: string[] = [];
    
    console.error = (...args: any[]) => {
      const message = args.join(' ');
      // Suppress pdf2json's verbose error output (we'll log it ourselves)
      if (
        message.includes('Invalid XRef stream header') ||
        message.includes('pdfjs-code.js') ||
        message.includes('while reading XRef')
      ) {
        suppressedErrors.push(message);
        return; // Suppress this output
      }
      // Allow other console.error messages through
      originalConsoleError.apply(console, args);
    };

    return new Promise<any>((resolve, reject) => {
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        // Restore console.error
        console.error = originalConsoleError;
        
        const error = errData.parserError;
        const errorMessage = error?.message || String(error);
        
        // Log a clean error message (suppressed verbose stack traces from library)
        this.logger.warn(`[PDF2JSON] Parse failed: ${errorMessage}`);
        if (suppressedErrors.length > 0) {
          this.logger.debug(
            `[PDF2JSON] Suppressed ${suppressedErrors.length} verbose error message(s) from pdf2json library`,
          );
        }
        
        // Reject with error (will be handled by caller's fallback logic)
        reject(error);
      });

      pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
        // Restore console.error on success
        console.error = originalConsoleError;
        
        this.logger.log(
          `[PDF2JSON] parse done: pages=${pdfData.Pages?.length}`,
        );
        resolve(pdfData);
      });

      pdfParser.parseBuffer(buffer);
    })
      .then((pdfData) => {
        // Ensure console.error is restored
        console.error = originalConsoleError;
        return this.mapPdfData(pdfData);
      })
      .catch((err) => {
        // Ensure console.error is restored even on error
        console.error = originalConsoleError;
        
        const errorMessage = err?.message || String(err);
        this.logger.warn(`[PDF2JSON] Parse failed: ${errorMessage}`);
        throw err;
      });
  }

  /**
   * Map raw pdf2json data to structured chunks
   *
   * The Pages property contains the contents of the PDF, while Meta contains the PDF metadata.
   * Each page object has Texts, Fields, Boxsets, HLines, VLines which we can inspect.
   *
   * @param pdfData - Raw data from pdf2json parser
   * @returns Structured chunks and metadata
   */
  private mapPdfData(pdfData: any) {
    const chunks: Array<{ id: string; content: string }> = [];

    // Process each page
    for (const [pageIndex, page] of (pdfData.Pages ?? []).entries()) {
      // Extract text segments from the page
      // The Texts entries store percent-encoded text segments; need to decodeURIComponent to get human readable text
      const pageText = (page.Texts ?? [])
        .map((t: any) => decodeURIComponent(t.R.map((r: any) => r.T).join('')))
        .join(' ');

      // Add page content chunk
      chunks.push({
        id: `page_${pageIndex + 1}`,
        content: pageText,
      });

      // Extract form fields if present
      if (page.Fields) {
        for (const field of page.Fields) {
          const name = field.T?.Name ?? 'unknown';
          const value = field.V ?? '';

          chunks.push({
            id: `field_${pageIndex + 1}_${name}`,
            content: `Field ${name}: ${value}`,
          });
        }
      }
    }

    this.logger.log(
      `[PDF2JSON] Mapped to ${chunks.length} chunks from ${pdfData.Pages?.length} pages`,
    );

    return { chunks, meta: pdfData };
  }
}
