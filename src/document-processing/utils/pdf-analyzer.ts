/**
 * PDF Analyzer Utility
 *
 * Determines whether a PDF contains extractable text or is image-based (scanned).
 *
 * Strategy:
 * 1. Try to extract text using pdf-parse
 * 2. If text extraction yields significant content → text-based PDF
 * 3. If minimal/no text → image-based PDF (needs OCR)
 *
 * Heuristics:
 * - Text-based: > 100 characters of extracted text
 * - Image-based: <= 100 characters (likely just metadata or headers)
 */

export interface PdfAnalysisResult {
  isTextBased: boolean;
  hasExtractableText: boolean;
  extractedText: string;
  pageCount: number;
  charCount: number;
  metadata?: any;
}

/**
 * Import pdf-parse:
 * NOTE: pdf-parse v2.4.5 exports PDFParse as a named export, not default.
 * The package has "type": "module" but provides CJS build for Node.js.
 * We use destructured require() to get the correct function.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse');

// Verify it's actually a function at module load time
if (typeof PDFParse !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const allExports = require('pdf-parse');
  throw new Error(
    `[PDF-PARSE-IMPORT] Import failed: PDFParse is ${typeof PDFParse}, expected function. ` +
      `Available exports: ${Object.keys(allExports).join(', ')}`,
  );
}

console.log('[PDF-PARSE-IMPORT] Successfully imported PDFParse function');

// Alias for consistency with existing code
const pdfParse = PDFParse;

export const analyzePdf = async (
  buffer: Buffer | Uint8Array | ArrayBuffer,
): Promise<PdfAnalysisResult> => {
  try {
    // Ensure buffer is valid Node Buffer (handles Uint8Array, ArrayBuffer, etc.)
    if (!Buffer.isBuffer(buffer)) {
      if (buffer instanceof Uint8Array) {
        buffer = Buffer.from(buffer);
      } else if (buffer instanceof ArrayBuffer) {
        buffer = Buffer.from(new Uint8Array(buffer));
      } else {
        throw new Error(
          'Invalid buffer: must be Buffer, Uint8Array, or ArrayBuffer',
        );
      }
    }

    if (buffer.length === 0) {
      throw new Error('Invalid buffer: buffer is empty');
    }

    console.log(`[PDF-PARSE] Analyzing PDF buffer: ${buffer.length} bytes`);

    // Parse PDF - pdf-parse returns a promise with text, numpages, info, metadata
    const data = await pdfParse(buffer);

    const extractedText = data.text || '';
    const charCount = extractedText.trim().length;
    const pageCount = data.numpages || 1;

    // Debug logging: Show what was actually extracted
    console.log(
      `[PDF-PARSE] Successfully extracted text: ${charCount} chars across ${pageCount} pages`,
    );
    console.log(
      `[PDF-PARSE] First 500 chars: ${extractedText.substring(0, 500)}`,
    );
    console.log(
      `[PDF-PARSE] PDF Info: ${JSON.stringify({
        producer: data.info?.Producer,
        creator: data.info?.Creator,
        version: data.version,
      })}`,
    );

    // Heuristic: If we have > 100 meaningful characters, it's text-based
    // This threshold filters out PDFs that only have headers/footers but no content
    const MIN_TEXT_THRESHOLD = 100;
    const hasExtractableText = charCount > MIN_TEXT_THRESHOLD;

    // Additional check: character-to-page ratio
    // Text-based PDFs typically have 200+ characters per page
    // Image-based PDFs have < 50 characters per page (just metadata)
    const charsPerPage = pageCount > 0 ? charCount / pageCount : 0;
    const isTextBased = hasExtractableText && charsPerPage > 50;

    console.log(
      `[PDF-PARSE] Analysis: isTextBased=${isTextBased}, charsPerPage=${Math.round(charsPerPage)}`,
    );

    return {
      isTextBased,
      hasExtractableText,
      extractedText: extractedText.substring(0, 10000), // Limit to first 10k chars
      pageCount,
      charCount,
      metadata: {
        info: data.info,
        version: data.version,
        charsPerPage: Math.round(charsPerPage),
      },
    };
  } catch (error) {
    // If parsing fails, assume it's an image-based PDF or corrupted
    // Fall back to OCR
    throw new Error(`PDF analysis failed: ${error.message}`);
  }
};

/**
 * Quick check without full text extraction (faster for large PDFs)
 */
export const quickPdfCheck = async (buffer: Buffer): Promise<boolean> => {
  try {
    const data = await pdfParse(buffer, {
      // Parse only first 3 pages for speed
      max: 3,
    });

    const charCount = (data.text || '').trim().length;
    const charsPerPage =
      data.numpages > 0 ? charCount / Math.min(data.numpages, 3) : 0;

    // Quick heuristic: > 50 chars per page suggests text-based
    return charsPerPage > 50;
  } catch {
    // If quick check fails, return false (will trigger OCR)
    return false;
  }
};
