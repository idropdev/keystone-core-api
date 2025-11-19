import { DocumentStatus } from '../enums/document-status.enum';
import { DocumentType } from '../enums/document-type.enum';
import { ProcessingMethod } from '../enums/processing-method.enum';

export class Document {
  id: string;
  userId: string | number;

  // Classification
  documentType: DocumentType;
  status: DocumentStatus;
  processingMethod?: ProcessingMethod; // How document was processed

  // File references (GCS URIs - NEVER log these)
  rawFileUri: string; // gs://bucket/raw/{userId}/{docId}.pdf
  processedFileUri?: string; // gs://bucket/processed/{userId}/{docId}.json

  // OCR results (PHI - handle with care)
  ocrJsonOutput?: any; // Full Document AI JSON response
  extractedText?: string; // Plain text extraction (first 5000 chars)
  confidence?: number; // Overall OCR confidence (0-1)

  // File metadata
  fileName: string;
  fileSize: number; // Bytes
  mimeType: string;
  pageCount?: number; // For processing mode selection
  description?: string; // User-provided description

  // Error tracking
  errorMessage?: string; // Sanitized error message
  retryCount?: number; // Number of processing attempts

  // Timestamps
  uploadedAt: Date;
  processingStartedAt?: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date; // Soft delete timestamp
  scheduledDeletionAt?: Date; // Hard delete after retention period
}
