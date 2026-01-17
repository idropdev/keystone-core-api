import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessRequestEntity } from '../entities/access-request.entity';
import { AccessRequestRepository } from '../../../../domain/repositories/access-request.repository.port';
import { AccessRequest } from '../../../../domain/entities/access-request.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';

/**
 * Access Request Relational Repository
 *
 * SYSTEM-100: Access Request Workflow
 */
@Injectable()
export class AccessRequestRelationalRepository
  implements AccessRequestRepository
{
  constructor(
    @InjectRepository(AccessRequestEntity)
    private readonly repository: Repository<AccessRequestEntity>,
  ) {}

  async create(
    data: Omit<AccessRequest, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AccessRequest> {
    const entity = this.repository.create({
      documentId: data.documentId,
      requestedByManagerId: data.requestedByManagerId,
      status: data.status,
      requestReason: data.requestReason,
    });

    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: number): Promise<NullableType<AccessRequest>> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByDocumentId(documentId: string): Promise<AccessRequest[]> {
    const entities = await this.repository.find({ where: { documentId } });
    return entities.map((e) => this.toDomain(e));
  }

  async findPendingByDocumentId(documentId: string): Promise<AccessRequest[]> {
    const entities = await this.repository.find({
      where: { documentId, status: 'pending' },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findByRequesterId(managerId: number): Promise<AccessRequest[]> {
    const entities = await this.repository.find({
      where: { requestedByManagerId: managerId },
      order: { createdAt: 'DESC' },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async update(
    id: number,
    data: Partial<AccessRequest>,
  ): Promise<AccessRequest> {
    await this.repository.update(id, {
      status: data.status,
      reviewedByManagerId: data.reviewedByManagerId,
      reviewedAt: data.reviewedAt,
      reviewNotes: data.reviewNotes,
    });

    const updated = await this.repository.findOneOrFail({ where: { id } });
    return this.toDomain(updated);
  }

  async findPendingForOriginManager(
    originManagerId: number,
  ): Promise<AccessRequest[]> {
    // Join with documents to find requests for documents where originManagerId matches
    const entities = await this.repository
      .createQueryBuilder('ar')
      .innerJoin('documents', 'd', 'd.id = ar.document_id')
      .where('d.origin_manager_id = :originManagerId', { originManagerId })
      .andWhere('ar.status = :status', { status: 'pending' })
      .orderBy('ar.created_at', 'DESC')
      .getMany();

    return entities.map((e) => this.toDomain(e));
  }

  private toDomain(entity: AccessRequestEntity): AccessRequest {
    return {
      id: entity.id,
      documentId: entity.documentId,
      requestedByManagerId: entity.requestedByManagerId,
      status: entity.status,
      requestReason: entity.requestReason,
      reviewedByManagerId: entity.reviewedByManagerId,
      reviewedAt: entity.reviewedAt,
      reviewNotes: entity.reviewNotes,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
