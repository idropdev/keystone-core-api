export interface FileMetadata {
  documentId: string;
  userId: string | number;
  fileName: string;
  mimeType: string;
  contentLength: number;
}

export interface StorageServicePort {
  /**
   * Upload raw document file to GCS
   * @returns GCS URI (gs://bucket/path)
   */
  storeRaw(fileBuffer: Buffer, metadata: FileMetadata): Promise<string>;

  /**
   * Store processed JSON output to GCS
   * @returns GCS URI
   */
  storeProcessed(jsonData: any, metadata: FileMetadata): Promise<string>;

  /**
   * Delete file from GCS (for hard delete after retention)
   */
  delete(gcsUri: string): Promise<void>;

  /**
   * Generate signed URL for secure download
   * @param expiresIn - Seconds until expiry (default: 24 hours)
   * @returns Signed URL
   */
  getSignedUrl(gcsUri: string, expiresIn?: number): Promise<string>;
}
