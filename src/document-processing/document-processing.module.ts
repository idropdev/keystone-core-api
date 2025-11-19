import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { ScheduleModule } from '@nestjs/schedule';
import documentProcessingConfig from './config/document-processing.config';
import { DocumentProcessingController } from './document-processing.controller';
import { DocumentProcessingService } from './document-processing.service';
import { DocumentProcessingDomainService } from './domain/services/document-processing.domain.service';
import { DocumentEntity } from './infrastructure/persistence/relational/entities/document.entity';
import { ExtractedFieldEntity } from './infrastructure/persistence/relational/entities/extracted-field.entity';
import { DocumentRepositoryAdapter } from './infrastructure/persistence/relational/repositories/document.repository';
import { GcpStorageAdapter } from './infrastructure/storage/gcp-storage.adapter';
import { GcpDocumentAiAdapter } from './infrastructure/ocr/gcp-document-ai.adapter';
import { Pdf2JsonService } from './infrastructure/pdf-extraction/pdf2json.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forFeature(documentProcessingConfig),

    // Database
    TypeOrmModule.forFeature([DocumentEntity, ExtractedFieldEntity]),

    // File upload
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB
        files: 1,
      },
    }),

    // Cron jobs for cleanup
    ScheduleModule.forRoot(),

    // Audit logging
    AuditModule,
  ],
  controllers: [DocumentProcessingController],
  providers: [
    // Application layer
    DocumentProcessingService,

    // Domain layer
    DocumentProcessingDomainService,

    // Infrastructure adapters (Hexagonal Architecture)
    {
      provide: 'DocumentRepositoryPort',
      useClass: DocumentRepositoryAdapter,
    },
    {
      provide: 'StorageServicePort',
      useClass: GcpStorageAdapter,
    },
    {
      provide: 'OcrServicePort',
      useClass: GcpDocumentAiAdapter,
    },

    // Direct injection for domain service (since it uses constructor injection)
    DocumentRepositoryAdapter,
    GcpStorageAdapter,
    GcpDocumentAiAdapter,

    // PDF extraction service
    Pdf2JsonService,
  ],
  exports: [DocumentProcessingService],
})
export class DocumentProcessingModule {}
