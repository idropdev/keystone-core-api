import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { DocumentAnythingLLMPathEntity } from '../relational/entities/document-anythingllm-path.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';

/**
 * Repository abstract class for document->AnythingLLM path mappings
 *
 * Abstract class (not interface) to allow use as dependency injection token in NestJS.
 */
export abstract class DocumentAnythingLLMPathRepository {
  abstract upsertMapping(data: {
    documentId: string;
    workspaceSlug: string;
    anythingllmDocPath: string;
  }): Promise<DocumentAnythingLLMPathEntity>;

  abstract findByDocumentIdAndWorkspaceSlug(
    documentId: string,
    workspaceSlug: string,
  ): Promise<NullableType<DocumentAnythingLLMPathEntity>>;

  abstract findByDocumentIdsAndWorkspaceSlug(
    documentIds: string[],
    workspaceSlug: string,
  ): Promise<DocumentAnythingLLMPathEntity[]>;
}

/**
 * Relational repository implementation for document->AnythingLLM path mappings
 */
@Injectable()
export class DocumentAnythingLLMPathRelationalRepository
  implements DocumentAnythingLLMPathRepository
{
  constructor(
    @InjectRepository(DocumentAnythingLLMPathEntity)
    private readonly repository: Repository<DocumentAnythingLLMPathEntity>,
  ) {}

  async upsertMapping(data: {
    documentId: string;
    workspaceSlug: string;
    anythingllmDocPath: string;
  }): Promise<DocumentAnythingLLMPathEntity> {
    // TypeORM upsert is available but varies by version; implement via save with unique constraint.
    // We do a find + save to keep behavior stable across versions.
    const existing = await this.repository.findOne({
      where: {
        documentId: data.documentId,
        workspaceSlug: data.workspaceSlug,
      },
    });

    if (existing) {
      existing.anythingllmDocPath = data.anythingllmDocPath;
      return await this.repository.save(existing);
    }

    const created = this.repository.create(data);
    return await this.repository.save(created);
  }

  async findByDocumentIdAndWorkspaceSlug(
    documentId: string,
    workspaceSlug: string,
  ): Promise<NullableType<DocumentAnythingLLMPathEntity>> {
    return await this.repository.findOne({
      where: { documentId, workspaceSlug },
    });
  }

  async findByDocumentIdsAndWorkspaceSlug(
    documentIds: string[],
    workspaceSlug: string,
  ): Promise<DocumentAnythingLLMPathEntity[]> {
    if (documentIds.length === 0) {
      return [];
    }

    return await this.repository.find({
      where: {
        documentId: In(documentIds),
        workspaceSlug,
      },
    });
  }
}

