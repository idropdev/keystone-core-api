import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import { DocumentProcessingDomainService } from './domain/services/document-processing.domain.service';
import { DocumentAccessDomainService } from './domain/services/document-access.domain.service';
import { Actor } from '../access-control/domain/services/access-grant.domain.service';
import { Document } from './domain/entities/document.entity';
import { DocumentType } from './domain/enums/document-type.enum';
import { DocumentStatus } from './domain/enums/document-status.enum';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentStatusResponseDto } from './dto/document-status-response.dto';
import { DocumentListQueryDto } from './dto/document-list-query.dto';
import { ExtractedFieldResponseDto } from './dto/extracted-field-response.dto';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';

/**
 * Orchestration Service (Application Layer)
 *
 * Thin facade over domain service that handles:
 * - DTO transformations
 * - Pagination formatting
 * - Response mapping
 *
 * Business logic lives in domain service.
 */
@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    private readonly domainService: DocumentProcessingDomainService,
    private readonly accessService: DocumentAccessDomainService,
  ) {}

  async uploadDocument(
    actor: Actor,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    documentType: DocumentType,
    description?: string,
  ): Promise<Document> {
    // Determine originManagerId:
    // - If actor is a manager → they become the origin manager
    // - If actor is a user → we need their assigned manager (handled in domain service)
    return this.domainService.uploadDocument(
      actor,
      fileBuffer,
      fileName,
      mimeType,
      documentType,
      description,
    );
  }

  /**
   * Get document with access control (uses DocumentAccessDomainService)
   */
  async getDocument(
    documentId: string,
    actor: Actor,
  ): Promise<Document> {
    return this.accessService.getDocument(documentId, actor);
  }

  /**
   * Legacy method for backward compatibility (deprecated - use getDocument with Actor)
   */
  async getDocumentLegacy(
    documentId: string,
    userId: string | number,
  ): Promise<Document> {
    return this.domainService.getDocument(documentId, userId);
  }

  async getDocumentStatus(
    documentId: string,
    actor: Actor,
  ): Promise<DocumentStatusResponseDto> {
    const document = await this.accessService.getDocument(documentId, actor);

    const response = new DocumentStatusResponseDto();
    response.id = document.id;
    response.status = document.status;
    response.processingStartedAt = document.processingStartedAt;
    response.processedAt = document.processedAt;
    response.errorMessage = document.errorMessage;

    // Calculate progress percentage
    response.progress = this.calculateProgress(document.status);

    return response;
  }

  async listDocuments(
    actor: Actor,
    query: DocumentListQueryDto,
  ): Promise<InfinityPaginationResponseDto<DocumentResponseDto>> {
    const result = await this.accessService.listDocuments(actor, {
      skip: query.page ? (query.page - 1) * (query.limit || 10) : 0,
      limit: query.limit || 10,
      status: query.status,
    });

    return {
      data: result.data.map((doc) => this.toResponseDto(doc)),
      hasNextPage: result.skip + result.limit < result.total,
    };
  }

  async deleteDocument(documentId: string, actor: Actor): Promise<void> {
    // First, check if document exists (to return 404 if not found)
    // This must be done before authorization check to return correct status code
    const documentExists = await this.accessService.documentExists(documentId);
    if (!documentExists) {
      throw new NotFoundException('Document not found');
    }

    // Now check authorization (only origin manager can delete)
    const canDelete = await this.accessService.canPerformOperation(
      documentId,
      'delete',
      actor,
    );

    if (!canDelete) {
      throw new ForbiddenException(
        'Only the origin manager can delete documents',
      );
    }

    // Get document for deletion (already verified it exists and user is authorized)
    const document = await this.accessService.getDocument(documentId, actor);

    // Delete via domain service (it will handle soft delete and audit)
    return this.domainService.deleteDocument(documentId, actor.id);
  }

  async getDownloadUrl(documentId: string, actor: Actor): Promise<string> {
    // Check authorization (origin manager OR granted access)
    const canDownload = await this.accessService.canPerformOperation(
      documentId,
      'download',
      actor,
    );

    if (!canDownload) {
      throw new ForbiddenException('Access denied to document');
    }

    // Get document to verify it exists and get file URI
    const document = await this.accessService.getDocument(documentId, actor);

    // Generate signed URL via domain service
    return this.domainService.getDownloadUrl(documentId, actor.id);
  }

  async getExtractedFields(
    documentId: string,
    actor: Actor,
  ): Promise<ExtractedFieldResponseDto[]> {
    this.logger.log(
      `[APP SERVICE] Getting extracted fields for document ${documentId}`,
    );

    // Check authorization (origin manager OR granted access)
    const canView = await this.accessService.canPerformOperation(
      documentId,
      'view',
      actor,
    );

    if (!canView) {
      throw new ForbiddenException('Access denied to document');
    }

    // Get document to verify it exists
    await this.accessService.getDocument(documentId, actor);

    // Get fields via domain service
    const fields = await this.domainService.getExtractedFields(
      documentId,
      actor.id,
    );

    this.logger.log(
      `[APP SERVICE] Received ${fields.length} fields from domain service`,
    );

    if (fields.length > 0) {
      this.logger.debug(
        `[APP SERVICE] First field before transformation: ${JSON.stringify({
          id: fields[0].id,
          documentId: fields[0].documentId,
          fieldKey: fields[0].fieldKey,
          fieldValue: fields[0].fieldValue?.substring(0, 30),
          fieldType: fields[0].fieldType,
          confidence: fields[0].confidence,
        })}`,
      );
    }

    const dtos = fields.map((field) =>
      plainToClass(ExtractedFieldResponseDto, field, {
        excludeExtraneousValues: true,
      }),
    );

    this.logger.log(`[APP SERVICE] Transformed to ${dtos.length} DTOs`);

    if (dtos.length > 0) {
      this.logger.debug(
        `[APP SERVICE] First DTO after transformation: ${JSON.stringify(dtos[0])}`,
      );
    }

    return dtos;
  }

  /**
   * Trigger OCR processing (origin manager only)
   */
  async triggerOcr(documentId: string, actor: Actor): Promise<void> {
    return this.domainService.triggerOcr(documentId, actor);
  }

  /**
   * Assign a manager to a self-managed document
   */
  async assignManagerToDocument(
    documentId: string,
    managerId: number,
    actor: Actor,
  ): Promise<Document> {
    return this.domainService.assignManagerToDocument(
      documentId,
      managerId,
      actor,
    );
  }

  /**
   * Transform domain entity to response DTO
   * SECURITY: Only expose safe fields, never internal URIs
   */
  toResponseDto(document: Document): DocumentResponseDto {
    return plainToClass(
      DocumentResponseDto,
      {
        id: document.id,
        documentType: document.documentType,
        status: document.status,
        fileName: document.fileName,
        fileSize: document.fileSize,
        mimeType: document.mimeType,
        description: document.description,
        confidence: document.confidence,
        errorMessage: document.errorMessage,
        uploadedAt: document.uploadedAt,
        processedAt: document.processedAt,
        createdAt: document.createdAt,
        originManagerId: document.originManagerId,
      },
      { excludeExtraneousValues: true },
    );
  }

  /**
   * Calculate processing progress (0-100)
   */
  private calculateProgress(status: DocumentStatus): number {
    const progressMap: Record<DocumentStatus, number> = {
      [DocumentStatus.UPLOADED]: 10,
      [DocumentStatus.STORED]: 20,
      [DocumentStatus.QUEUED]: 30,
      [DocumentStatus.PROCESSING]: 50,
      [DocumentStatus.PROCESSED]: 100,
      [DocumentStatus.FAILED]: 0,
      [DocumentStatus.ARCHIVED]: 100,
    };

    return progressMap[status] || 0;
  }
}
