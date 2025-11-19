export enum DocumentStatus {
  UPLOADED = 'UPLOADED', // File received, not yet stored
  STORED = 'STORED', // Saved to GCS
  QUEUED = 'QUEUED', // Queued for OCR processing
  PROCESSING = 'PROCESSING', // OCR in progress
  PROCESSED = 'PROCESSED', // OCR complete
  FAILED = 'FAILED', // Processing failed
  ARCHIVED = 'ARCHIVED', // Soft deleted by user
}
