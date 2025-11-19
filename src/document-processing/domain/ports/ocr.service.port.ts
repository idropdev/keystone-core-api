export interface OcrResult {
  text: string; // Extracted plain text
  confidence: number; // Overall confidence (0-1)
  pageCount: number;
  entities?: Array<{
    // Structured entities (names, dates, etc.)
    type: string;
    mentionText: string;
    confidence: number;
    startOffset?: number;
    endOffset?: number;
  }>;
  fullResponse: any; // Complete Document AI response
  outputRef?: string; // For batch: GCS URI of output folder
}

export interface OcrServicePort {
  /**
   * Process document with Google Document AI
   * Automatically selects sync or batch mode based on document size
   * @param gcsUri - GCS URI of raw document
   * @param mimeType - Document MIME type
   * @param pageCount - Optional page count for mode selection
   * @returns OCR results
   */
  processDocument(
    gcsUri: string,
    mimeType: string,
    pageCount?: number,
  ): Promise<OcrResult>;
}
