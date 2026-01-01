import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In, IsNull } from 'typeorm';
import { DocumentRepositoryPort } from '../../../../domain/ports/document.repository.port';
import { Document } from '../../../../domain/entities/document.entity';
import { ExtractedField } from '../../../../domain/entities/extracted-field.entity';
import { DocumentEntity } from '../entities/document.entity';
import { ExtractedFieldEntity } from '../entities/extracted-field.entity';
import { DocumentMapper } from '../mappers/document.mapper';
import { ExtractedFieldMapper } from '../mappers/extracted-field.mapper';
import { DocumentStatus } from '../../../../domain/enums/document-status.enum';
import { NullableType } from '../../../../../utils/types/nullable.type';

@Injectable()
export class DocumentRepositoryAdapter implements DocumentRepositoryPort {
  private readonly logger = new Logger(DocumentRepositoryAdapter.name);

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly documentRepository: Repository<DocumentEntity>,
    @InjectRepository(ExtractedFieldEntity)
    private readonly extractedFieldRepository: Repository<ExtractedFieldEntity>,
  ) {}

  async save(document: Document): Promise<Document> {
    const entity = DocumentMapper.toPersistence(document);
    const saved = await this.documentRepository.save(entity);
    return DocumentMapper.toDomain(saved);
  }

  async update(id: string, partial: Partial<Document>): Promise<void> {
    await this.documentRepository.update(id, partial as any);
  }

  async updateStatus(
    id: string,
    status: DocumentStatus,
    fields?: Partial<Document>,
  ): Promise<void> {
    await this.documentRepository.update(id, { status, ...fields } as any);
  }

  async findById(id: string): Promise<NullableType<Document>> {
    const entity = await this.documentRepository.findOne({
      where: { id },
    });
    return entity ? DocumentMapper.toDomain(entity) : null;
  }

  async findByIdAndUserId(
    id: string,
    userId: string | number,
  ): Promise<NullableType<Document>> {
    const numericUserId =
      typeof userId === 'string' ? parseInt(userId, 10) : userId;
    const entity = await this.documentRepository.findOne({
      where: { id, userId: numericUserId },
    });
    return entity ? DocumentMapper.toDomain(entity) : null;
  }

  async findByUserId(
    userId: string | number,
    options?: { skip?: number; limit?: number; status?: DocumentStatus[] },
  ): Promise<{ data: Document[]; total: number }> {
    const numericUserId =
      typeof userId === 'string' ? parseInt(userId, 10) : userId;
    const where: any = { userId: numericUserId };
    if (options?.status) {
      where.status = In(options.status);
    }

    const [entities, total] = await this.documentRepository.findAndCount({
      where,
      skip: options?.skip,
      take: options?.limit,
      order: { createdAt: 'DESC' },
    });

    return {
      data: entities.map(DocumentMapper.toDomain),
      total,
    };
  }

  async findByOriginManagerId(
    managerId: number,
    options?: { skip?: number; limit?: number; status?: DocumentStatus[] },
  ): Promise<{ data: Document[]; total: number }> {
    const where: any = { originManagerId: managerId, deletedAt: IsNull() };
    if (options?.status) {
      where.status = In(options.status);
    }

    const [entities, total] = await this.documentRepository.findAndCount({
      where,
      skip: options?.skip,
      take: options?.limit,
      order: { createdAt: 'DESC' },
    });

    return {
      data: entities.map(DocumentMapper.toDomain),
      total,
    };
  }

  async findExpired(): Promise<Document[]> {
    const entities = await this.documentRepository.find({
      where: {
        scheduledDeletionAt: LessThan(new Date()),
        deletedAt: IsNull(), // Only soft-deleted documents
      },
    });
    return entities.map(DocumentMapper.toDomain);
  }

  async hardDelete(id: string): Promise<void> {
    await this.documentRepository.delete(id);
  }

  async saveExtractedFields(fields: ExtractedField[]): Promise<void> {
    this.logger.log(
      `[REPOSITORY] Saving ${fields.length} extracted fields to database`,
    );
    this.logger.debug(
      `[REPOSITORY] Fields to save: ${JSON.stringify(
        fields.map((f) => ({
          documentId: f.documentId,
          fieldKey: f.fieldKey,
          fieldValue: f.fieldValue?.substring(0, 30),
        })),
      )}`,
    );

    const entities = fields.map(ExtractedFieldMapper.toPersistence);
    this.logger.debug(
      `[REPOSITORY] Mapped to entities, first entity: ${JSON.stringify({
        documentId: entities[0]?.documentId,
        fieldKey: entities[0]?.fieldKey,
        hasDocument: !!entities[0]?.document,
      })}`,
    );

    const saved = await this.extractedFieldRepository.save(entities);
    this.logger.log(
      `[REPOSITORY] Successfully saved ${saved.length} extracted fields`,
    );
  }

  async findExtractedFieldsByDocumentId(
    documentId: string,
  ): Promise<ExtractedField[]> {
    this.logger.log(
      `[REPOSITORY] Querying extracted fields for documentId: ${documentId}`,
    );

    const entities = await this.extractedFieldRepository.find({
      where: { documentId },
    });

    this.logger.log(
      `[REPOSITORY] Query returned ${entities.length} entities from database`,
    );

    if (entities.length > 0) {
      this.logger.debug(
        `[REPOSITORY] First entity from DB: ${JSON.stringify({
          id: entities[0].id,
          documentId: entities[0].documentId,
          fieldKey: entities[0].fieldKey,
          fieldValue: entities[0].fieldValue?.substring(0, 30),
        })}`,
      );
    }

    const mapped = entities.map(ExtractedFieldMapper.toDomain);
    this.logger.log(`[REPOSITORY] Mapped to ${mapped.length} domain objects`);

    return mapped;
  }
}
