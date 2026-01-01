import { Document } from '../../../../domain/entities/document.entity';
import { DocumentEntity } from '../entities/document.entity';

export class DocumentMapper {
  static toDomain(entity: DocumentEntity): Document {
    const domain = new Document();
    domain.id = entity.id;
    domain.userId = entity.userId || entity.user?.id; // Use direct userId or relation
    domain.originManagerId = entity.originManagerId;
    domain.originUserContextId = entity.originUserContextId || undefined;
    domain.documentType = entity.documentType;
    domain.status = entity.status;
    domain.rawFileUri = entity.rawFileUri;
    domain.processedFileUri = entity.processedFileUri;
    domain.ocrJsonOutput = entity.ocrJsonOutput;
    domain.extractedText = entity.extractedText;
    domain.confidence = entity.confidence
      ? parseFloat(entity.confidence.toString())
      : undefined;
    domain.fileName = entity.fileName;
    domain.fileSize = entity.fileSize;
    domain.mimeType = entity.mimeType;
    domain.pageCount = entity.pageCount;
    domain.description = entity.description;
    domain.errorMessage = entity.errorMessage;
    domain.retryCount = entity.retryCount;
    domain.uploadedAt = entity.uploadedAt;
    domain.processingStartedAt = entity.processingStartedAt;
    domain.processedAt = entity.processedAt;
    domain.createdAt = entity.createdAt;
    domain.updatedAt = entity.updatedAt;
    domain.deletedAt = entity.deletedAt;
    domain.scheduledDeletionAt = entity.scheduledDeletionAt;
    domain.processingMethod = entity.processingMethod;
    return domain;
  }

  static toPersistence(domain: Document): DocumentEntity {
    const entity = new DocumentEntity();
    if (domain.id) entity.id = domain.id;

    // Set user ID (TypeORM will handle the relation)
    entity.userId =
      typeof domain.userId === 'string'
        ? parseInt(domain.userId, 10)
        : domain.userId;

    // Set origin manager ID (IMMUTABLE - set at creation only)
    entity.originManagerId = domain.originManagerId;
    entity.originUserContextId = domain.originUserContextId;

    entity.documentType = domain.documentType;
    entity.status = domain.status;
    entity.rawFileUri = domain.rawFileUri;
    entity.processedFileUri = domain.processedFileUri;
    entity.ocrJsonOutput = domain.ocrJsonOutput;
    entity.extractedText = domain.extractedText;
    entity.confidence = domain.confidence;
    entity.fileName = domain.fileName;
    entity.fileSize = domain.fileSize;
    entity.mimeType = domain.mimeType;
    entity.pageCount = domain.pageCount;
    entity.description = domain.description;
    entity.errorMessage = domain.errorMessage;
    entity.retryCount = domain.retryCount || 0;
    entity.uploadedAt = domain.uploadedAt;
    entity.processingStartedAt = domain.processingStartedAt;
    entity.processedAt = domain.processedAt;
    entity.deletedAt = domain.deletedAt;
    entity.scheduledDeletionAt = domain.scheduledDeletionAt;
    entity.processingMethod = domain.processingMethod;
    return entity;
  }
}
