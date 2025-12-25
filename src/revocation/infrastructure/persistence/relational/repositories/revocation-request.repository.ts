import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RevocationRequestRepositoryPort } from '../../../../domain/repositories/revocation-request.repository.port';
import { RevocationRequest } from '../../../../domain/entities/revocation-request.entity';
import { RevocationRequestEntity } from '../entities/revocation-request.entity';

/**
 * Relational Repository Implementation for RevocationRequest
 * 
 * Maps between domain entities and TypeORM entities.
 */
@Injectable()
export class RevocationRequestRelationalRepository
  extends RevocationRequestRepositoryPort
{
  constructor(
    @InjectRepository(RevocationRequestEntity)
    private readonly repository: Repository<RevocationRequestEntity>,
  ) {
    super(); // Required when extending abstract class
  }

  async create(
    request: Omit<RevocationRequest, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<RevocationRequest> {
    const entity = this.toEntity(request);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: number): Promise<RevocationRequest | null> {
    const entity = await this.repository.findOne({
      where: { id },
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
  }

  async findByDocumentId(documentId: string): Promise<RevocationRequest[]> {
    const entities = await this.repository.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async findByRequester(
    requestedByType: 'user' | 'manager',
    requestedById: number,
  ): Promise<RevocationRequest[]> {
    const entities = await this.repository.find({
      where: {
        requestedByType,
        requestedById,
      },
      order: { createdAt: 'DESC' },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async findPendingByDocumentId(
    documentId: string,
  ): Promise<RevocationRequest[]> {
    const entities = await this.repository.find({
      where: {
        documentId,
        status: 'pending',
      },
      order: { createdAt: 'ASC' },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async update(
    id: number,
    updates: Partial<RevocationRequest>,
  ): Promise<RevocationRequest> {
    await this.repository.update(id, updates);
    const updated = await this.repository.findOne({ where: { id } });

    if (!updated) {
      throw new Error(`RevocationRequest ${id} not found after update`);
    }

    return this.toDomain(updated);
  }

  async softDelete(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }

  /**
   * Map domain entity to TypeORM entity
   */
  private toEntity(domain: Partial<RevocationRequest>): RevocationRequestEntity {
    const entity = new RevocationRequestEntity();
    entity.documentId = domain.documentId!;
    entity.requestedByType = domain.requestedByType!;
    entity.requestedById = domain.requestedById!;
    entity.requestType = domain.requestType!;
    entity.status = domain.status || 'pending';
    entity.cascadeToSecondaryManagers = domain.cascadeToSecondaryManagers || false;
    entity.reviewNotes = domain.reviewNotes;
    entity.reviewedBy = domain.reviewedBy;
    entity.reviewedAt = domain.reviewedAt;
    entity.deletedAt = domain.deletedAt;
    return entity;
  }

  /**
   * Map TypeORM entity to domain entity
   */
  private toDomain(entity: RevocationRequestEntity): RevocationRequest {
    return {
      id: entity.id,
      documentId: entity.documentId,
      requestedByType: entity.requestedByType,
      requestedById: entity.requestedById,
      requestType: entity.requestType,
      status: entity.status,
      cascadeToSecondaryManagers: entity.cascadeToSecondaryManagers,
      reviewNotes: entity.reviewNotes,
      reviewedBy: entity.reviewedBy,
      reviewedAt: entity.reviewedAt,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
    };
  }
}

