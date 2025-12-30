import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import documentProcessingConfig from './config/document-processing.config';
import { DocumentProcessingController } from './document-processing.controller';
import { DocumentProcessingService } from './document-processing.service';
import { DocumentProcessingDomainService } from './domain/services/document-processing.domain.service';
import { DocumentAccessDomainService } from './domain/services/document-access.domain.service';
import { DocumentEntity } from './infrastructure/persistence/relational/entities/document.entity';
import { ExtractedFieldEntity } from './infrastructure/persistence/relational/entities/extracted-field.entity';
import { ManagerEntity } from '../managers/infrastructure/persistence/relational/entities/manager.entity';
import { RelationalManagerPersistenceModule } from '../managers/infrastructure/persistence/relational/relational-persistence.module';
import { ManagerRepositoryPort } from '../managers/domain/repositories/manager.repository.port';
import { DocumentRepositoryAdapter } from './infrastructure/persistence/relational/repositories/document.repository';
import { GcpStorageAdapter } from './infrastructure/storage/gcp-storage.adapter';
import { GcpDocumentAiAdapter } from './infrastructure/ocr/gcp-document-ai.adapter';
import { GcpVisionAiAdapter } from './infrastructure/ocr/gcp-vision-ai.adapter';
import { Pdf2JsonService } from './infrastructure/pdf-extraction/pdf2json.service';
import { OcrMergeService } from './utils/ocr-merge.service';
import { OcrPostProcessorService } from './utils/ocr-post-processor.service';
import { AuditModule } from '../audit/audit.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forFeature(documentProcessingConfig),

    // Database
    // NOTE: ManagerEntity is needed for the originManager relationship
    TypeOrmModule.forFeature([
      DocumentEntity,
      ExtractedFieldEntity,
      ManagerEntity,
    ]),

    // File upload
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB
        files: 1,
      },
    }),

    // Audit logging
    AuditModule,

    // Access control (forwardRef to break circular dependency)
    forwardRef(() => AccessControlModule),

    // Users module (for UserManagerAssignmentService to determine origin manager)
    forwardRef(() => UsersModule),

    // Managers module (for ManagerInstance lookup)
    RelationalManagerPersistenceModule,
  ],
  controllers: [DocumentProcessingController],
  providers: [
    // Application layer
    DocumentProcessingService,

    // Domain layer
    DocumentProcessingDomainService,
    DocumentAccessDomainService,

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
      useClass: GcpDocumentAiAdapter, // Backward compatibility
    },
    {
      provide: 'VisionOcrServicePort',
      useClass: GcpVisionAiAdapter,
    },
    {
      provide: 'DocumentAiOcrServicePort',
      useClass: GcpDocumentAiAdapter,
    },

    // Direct injection for domain service (since it uses constructor injection)
    DocumentRepositoryAdapter,
    GcpStorageAdapter,
    GcpDocumentAiAdapter,
    GcpVisionAiAdapter,

    // Merge and post-processing services
    OcrMergeService,
    OcrPostProcessorService,

    // PDF extraction service
    Pdf2JsonService,

    // Manager repository port (string token provider for dependency injection)
    {
      provide: 'ManagerRepositoryPort',
      useExisting: ManagerRepositoryPort,
    },
  ],
  exports: [
    DocumentProcessingService,
    DocumentAccessDomainService, // Export for use in AccessControlModule
    'DocumentRepositoryPort', // Export for use in AccessControlModule
    'StorageServicePort', // Export for use in health checks
    GcpStorageAdapter, // Export for direct injection in health checks
  ],
})
export class DocumentProcessingModule {}
