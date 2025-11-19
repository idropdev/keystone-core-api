import { registerAs } from '@nestjs/config';
import { IsString, IsNumber, Min, Max, validateSync } from 'class-validator';
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
      gcp: {
        projectId: validatedConfig.DOC_PROCESSING_GCP_PROJECT_ID,
        documentAi: {
          location: validatedConfig.DOC_PROCESSING_GCP_LOCATION,
          processorId: validatedConfig.DOC_PROCESSING_PROCESSOR_ID,
          outputBucket: validatedConfig.DOC_PROCESSING_OUTPUT_BUCKET,
        },
        storage: {
          bucket: validatedConfig.DOC_PROCESSING_STORAGE_BUCKET,
          rawPrefix: validatedConfig.DOC_PROCESSING_RAW_PREFIX,
          processedPrefix: validatedConfig.DOC_PROCESSING_PROCESSED_PREFIX,
        },
      },
    };
  },
);
