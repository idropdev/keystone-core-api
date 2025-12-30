import { registerAs } from '@nestjs/config';
import {
  IsString,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  validateSync,
} from 'class-validator';
import { plainToClass } from 'class-transformer';
import { DocumentProcessingConfig } from './document-processing-config.type';

class EnvironmentVariablesValidator {
  @IsString()
  DOC_PROCESSING_GCP_PROJECT_ID: string;

  @IsString()
  DOC_PROCESSING_GCP_LOCATION: string;

  @IsString()
  DOC_PROCESSING_PROCESSOR_ID: string;

  @IsString()
  DOC_PROCESSING_OUTPUT_BUCKET: string;

  @IsString()
  DOC_PROCESSING_STORAGE_BUCKET: string;

  @IsString()
  DOC_PROCESSING_RAW_PREFIX: string = 'raw/';

  @IsString()
  DOC_PROCESSING_PROCESSED_PREFIX: string = 'processed/';

  @IsNumber()
  @Min(1)
  @Max(100)
  DOC_PROCESSING_MAX_FILE_SIZE_MB: number = 10;

  @IsNumber()
  @Min(6)
  DOC_PROCESSING_RETENTION_YEARS: number = 8;

  @IsNumber()
  @Min(1)
  @Max(50)
  DOC_PROCESSING_SYNC_MAX_PAGES: number = 15;

  // OCR Merge configuration
  @IsBoolean()
  DOC_PROCESSING_OCR_MERGE_ENABLED: boolean = true;

  @IsNumber()
  @Min(0)
  @Max(1)
  DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT: number = 0.7;

  @IsBoolean()
  DOC_PROCESSING_OCR_MERGE_FORCE_MERGE_ON_LOW_AGREEMENT: boolean = false;

  @IsNumber()
  @Min(0)
  @Max(1)
  DOC_PROCESSING_OCR_MERGE_LINE_MIX_THRESHOLD: number = 0.55;

  // Vision AI configuration (uses DOC_PROCESSING_STORAGE_BUCKET)
  @IsString()
  DOC_PROCESSING_VISION_ASYNC_OUTPUT_PREFIX: string = 'vision-ocr-output/';

  // Post-processing configuration
  @IsBoolean()
  DOC_PROCESSING_OCR_POST_PROCESSING_ENABLED: boolean = false;

  @IsBoolean()
  DOC_PROCESSING_OCR_POST_PROCESSING_USE_LM: boolean = false;

  @IsBoolean()
  DOC_PROCESSING_OCR_POST_PROCESSING_USE_REGEX: boolean = true;

  @IsNumber()
  @Min(0)
  @Max(1)
  DOC_PROCESSING_OCR_POST_PROCESSING_CONFIDENCE_THRESHOLD: number = 0.8;

  // Debug configuration
  @IsBoolean()
  DEBUG_OCR_STORE_SOURCES: boolean = false;
}

export default registerAs<DocumentProcessingConfig>(
  'documentProcessing',
  () => {
    const validatedConfig = plainToClass(
      EnvironmentVariablesValidator,
      {
        DOC_PROCESSING_GCP_PROJECT_ID:
          process.env.DOC_PROCESSING_GCP_PROJECT_ID,
        DOC_PROCESSING_GCP_LOCATION:
          process.env.DOC_PROCESSING_GCP_LOCATION || 'us',
        DOC_PROCESSING_PROCESSOR_ID: process.env.DOC_PROCESSING_PROCESSOR_ID,
        DOC_PROCESSING_OUTPUT_BUCKET: process.env.DOC_PROCESSING_OUTPUT_BUCKET,
        DOC_PROCESSING_STORAGE_BUCKET:
          process.env.DOC_PROCESSING_STORAGE_BUCKET,
        DOC_PROCESSING_RAW_PREFIX:
          process.env.DOC_PROCESSING_RAW_PREFIX || 'raw/',
        DOC_PROCESSING_PROCESSED_PREFIX:
          process.env.DOC_PROCESSING_PROCESSED_PREFIX || 'processed/',
        DOC_PROCESSING_MAX_FILE_SIZE_MB: process.env
          .DOC_PROCESSING_MAX_FILE_SIZE_MB
          ? parseInt(process.env.DOC_PROCESSING_MAX_FILE_SIZE_MB, 10)
          : 10,
        DOC_PROCESSING_RETENTION_YEARS: process.env
          .DOC_PROCESSING_RETENTION_YEARS
          ? parseInt(process.env.DOC_PROCESSING_RETENTION_YEARS, 10)
          : 8,
        DOC_PROCESSING_SYNC_MAX_PAGES: process.env.DOC_PROCESSING_SYNC_MAX_PAGES
          ? parseInt(process.env.DOC_PROCESSING_SYNC_MAX_PAGES, 10)
          : 15,
        DOC_PROCESSING_OCR_MERGE_ENABLED:
          process.env.DOC_PROCESSING_OCR_MERGE_ENABLED !== 'false',
        DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT: process.env
          .DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT
          ? parseFloat(process.env.DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT)
          : 0.7,
        DOC_PROCESSING_OCR_MERGE_FORCE_MERGE_ON_LOW_AGREEMENT:
          process.env.DOC_PROCESSING_OCR_MERGE_FORCE_MERGE_ON_LOW_AGREEMENT ===
          'true',
        DOC_PROCESSING_OCR_MERGE_LINE_MIX_THRESHOLD: process.env
          .DOC_PROCESSING_OCR_MERGE_LINE_MIX_THRESHOLD
          ? parseFloat(process.env.DOC_PROCESSING_OCR_MERGE_LINE_MIX_THRESHOLD)
          : 0.55,
        DOC_PROCESSING_VISION_ASYNC_OUTPUT_PREFIX:
          process.env.DOC_PROCESSING_VISION_ASYNC_OUTPUT_PREFIX ||
          'vision-ocr-output/',
        DOC_PROCESSING_OCR_POST_PROCESSING_ENABLED:
          process.env.DOC_PROCESSING_OCR_POST_PROCESSING_ENABLED === 'true',
        DOC_PROCESSING_OCR_POST_PROCESSING_USE_LM:
          process.env.DOC_PROCESSING_OCR_POST_PROCESSING_USE_LM === 'true',
        DOC_PROCESSING_OCR_POST_PROCESSING_USE_REGEX:
          process.env.DOC_PROCESSING_OCR_POST_PROCESSING_USE_REGEX !== 'false',
        DOC_PROCESSING_OCR_POST_PROCESSING_CONFIDENCE_THRESHOLD: process.env
          .DOC_PROCESSING_OCR_POST_PROCESSING_CONFIDENCE_THRESHOLD
          ? parseFloat(
              process.env.DOC_PROCESSING_OCR_POST_PROCESSING_CONFIDENCE_THRESHOLD,
            )
          : 0.8,
        DEBUG_OCR_STORE_SOURCES:
          process.env.DEBUG_OCR_STORE_SOURCES === 'true',
      },
      { enableImplicitConversion: true },
    );

    const errors = validateSync(validatedConfig, {
      skipMissingProperties: false,
    });

    if (errors.length > 0) {
      throw new Error(
        `Document Processing config validation error: ${errors.toString()}`,
      );
    }

    return {
      maxFileSizeMb: validatedConfig.DOC_PROCESSING_MAX_FILE_SIZE_MB,
      retentionYears: validatedConfig.DOC_PROCESSING_RETENTION_YEARS,
      syncMaxPages: validatedConfig.DOC_PROCESSING_SYNC_MAX_PAGES,
      ocrMerge: {
        enabled:
          validatedConfig.DOC_PROCESSING_OCR_MERGE_ENABLED !== false,
        minAgreement:
          validatedConfig.DOC_PROCESSING_OCR_MERGE_MIN_AGREEMENT || 0.7,
        forceMergeOnLowAgreement:
          validatedConfig.DOC_PROCESSING_OCR_MERGE_FORCE_MERGE_ON_LOW_AGREEMENT ||
          false,
        lineMixThreshold:
          validatedConfig.DOC_PROCESSING_OCR_MERGE_LINE_MIX_THRESHOLD || 0.55,
      },
      ocrPostProcessing: {
        enabled:
          validatedConfig.DOC_PROCESSING_OCR_POST_PROCESSING_ENABLED || false,
        useLanguageModel:
          validatedConfig.DOC_PROCESSING_OCR_POST_PROCESSING_USE_LM || false,
        useRegex:
          validatedConfig.DOC_PROCESSING_OCR_POST_PROCESSING_USE_REGEX !== false,
        confidenceThreshold:
          validatedConfig.DOC_PROCESSING_OCR_POST_PROCESSING_CONFIDENCE_THRESHOLD ||
          0.8,
      },
      gcp: {
        projectId: validatedConfig.DOC_PROCESSING_GCP_PROJECT_ID,
        documentAi: {
          location: validatedConfig.DOC_PROCESSING_GCP_LOCATION,
          processorId: validatedConfig.DOC_PROCESSING_PROCESSOR_ID,
          outputBucket: validatedConfig.DOC_PROCESSING_OUTPUT_BUCKET,
        },
        visionAi: {
          asyncOutputPrefix:
            validatedConfig.DOC_PROCESSING_VISION_ASYNC_OUTPUT_PREFIX ||
            'vision-ocr-output/',
        },
        storage: {
          bucket: validatedConfig.DOC_PROCESSING_STORAGE_BUCKET,
          rawPrefix: validatedConfig.DOC_PROCESSING_RAW_PREFIX,
          processedPrefix: validatedConfig.DOC_PROCESSING_PROCESSED_PREFIX,
        },
      },
      debug: {
        storeOcrSources:
          validatedConfig.DEBUG_OCR_STORE_SOURCES || false,
      },
    };
  },
);
