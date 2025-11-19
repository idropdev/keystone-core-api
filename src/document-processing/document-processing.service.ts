import { Injectable, Logger } from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import { DocumentProcessingDomainService } from './domain/services/document-processing.domain.service';
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
  ) {}

  async uploadDocument(
    userId: string | number,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    documentType: DocumentType,
    description?: string,
  ): Promise<Document> {
    return this.domainService.uploadDocument(
      userId,
      fileBuffer,
      fileName,
      mimeType,
      documentType,
      description,
    );
  }

  async getDocument(
    documentId: string,
    userId: string | number,
  ): Promise<Document> {
    return this.domainService.getDocument(documentId, userId);
  }

  async getDocumentStatus(
    documentId: string,
    userId: string | number,
  ): Promise<DocumentStatusResponseDto> {
    const document = await this.domainService.getDocument(documentId, userId);

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
    userId: string | number,
    query: DocumentListQueryDto,
  ): Promise<InfinityPaginationResponseDto<DocumentResponseDto>> {
    const result = await this.domainService.listDocuments(userId, {
      page: query.page,
      limit: query.limit,
      status: query.status,
    });

    return {
      data: result.data.map((doc) => this.toResponseDto(doc)),
      hasNextPage: result.page * result.limit < result.total,
    };
  }

  async deleteDocument(
    documentId: string,
    userId: string | number,
  ): Promise<void> {
    return this.domainService.deleteDocument(documentId, userId);
  }

  async getDownloadUrl(
    documentId: string,
    userId: string | number,
  ): Promise<string> {
    return this.domainService.getDownloadUrl(documentId, userId);
  }

  async getExtractedFields(
    documentId: string,
    userId: string | number,
  ): Promise<ExtractedFieldResponseDto[]> {
    this.logger.log(
      `[APP SERVICE] Getting extracted fields for document ${documentId}`,
    );

    const fields = await this.domainService.getExtractedFields(
      documentId,
      userId,
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
