/**
 * Processing Method Enum
 *
 * Tracks how a document was processed:
 * - DIRECT_EXTRACTION: Text extracted directly from PDF (native text)
 * - OCR_SYNC: Synchronous OCR via Document AI (small documents)
 * - OCR_BATCH: Batch OCR via Document AI (large documents)
 * - NONE: Not yet processed
 */
export enum ProcessingMethod {
  NONE = 'NONE',
  DIRECT_EXTRACTION = 'DIRECT_EXTRACTION',
  OCR_SYNC = 'OCR_SYNC',
  OCR_BATCH = 'OCR_BATCH',
}
