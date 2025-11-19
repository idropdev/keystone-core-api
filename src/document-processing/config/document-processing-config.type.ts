export type DocumentProcessingConfig = {
  maxFileSizeMb: number;
  retentionYears: number;
  syncMaxPages: number; // Threshold for sync vs batch processing
  gcp: {
    projectId: string;
    documentAi: {
      location: string;
      processorId: string;
      outputBucket: string; // For batch results
    };
    storage: {
      bucket: string;
      rawPrefix: string;
      processedPrefix: string;
    };
  };
};
