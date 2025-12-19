export type DocumentProcessingConfig = {
  maxFileSizeMb: number;
  retentionYears: number;
  syncMaxPages: number; // Threshold for sync vs batch processing
  ocrMerge: {
    enabled: boolean;
    minAgreement: number;
    forceMergeOnLowAgreement: boolean;
    lineMixThreshold: number;
  };
  ocrPostProcessing: {
    enabled: boolean;
    useLanguageModel: boolean;
    useRegex: boolean;
    confidenceThreshold: number;
  };
  gcp: {
    projectId: string;
    documentAi: {
      location: string;
      processorId: string;
      outputBucket: string; // For batch results
    };
    visionAi: {
      asyncOutputPrefix: string; // Uses storage bucket, no separate bucket needed
    };
    storage: {
      bucket: string;
      rawPrefix: string;
      processedPrefix: string;
    };
  };
  debug: {
    storeOcrSources: boolean;
  };
};
