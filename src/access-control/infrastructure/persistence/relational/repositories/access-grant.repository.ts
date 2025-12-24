import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AccessGrantEntity } from '../entities/access-grant.entity';
import { AccessGrantRepository } from '../../../domain/repositories/access-grant.repository.port';
import { AccessGrant } from '../../../domain/entities/access-grant.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';

@Injectable()
export class AccessGrantRelationalRepository
  implements AccessGrantRepository
{
  constructor(
    @InjectRepository(AccessGrantEntity)
    private readonly repository: Repository<AccessGrantEntity>,
  ) {}

  async findActive(
    documentId: string,
    subjectType: 'user' | 'manager',
    subjectId: number,
  ): Promise<NullableType<AccessGrant>> {
    const entity = await this.repository.findOne({
      where: {
        documentId,
        subjectType,
        subjectId,
        revokedAt: IsNull(),
      },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByDocumentId(documentId: string): Promise<AccessGrant[]> {
    const entities = await this.repository.find({
      where: {
        documentId,
        revokedAt: IsNull(),
      },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async findBySubject(
    subjectType: 'user' | 'manager',
    subjectId: number,
  ): Promise<AccessGrant[]> {
    const entities = await this.repository.find({
      where: {
        subjectType,
        subjectId,
        revokedAt: IsNull(),
      },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async create(
    data: Omit<AccessGrant, 'id' | 'createdAt'>,
  ): Promise<AccessGrant> {
    const entity = this.repository.create({
      documentId: data.documentId,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      grantType: data.grantType,
      grantedByType: data.grantedByType,
      grantedById: data.grantedById,
      revokedAt: data.revokedAt,
      revokedByType: data.revokedByType,
      revokedById: data.revokedById,
    });

    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: number): Promise<NullableType<AccessGrant>> {
    const entity = await this.repository.findOne({
      where: { id },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async revoke(
    id: number,
    revokedByType: 'user' | 'manager',
    revokedById: number,
  ): Promise<void> {
    await this.repository.update(id, {
      revokedAt: new Date(),
      revokedByType,
      revokedById,
    });
  }

  private toDomain(entity: AccessGrantEntity): AccessGrant {
    return {
      id: entity.id,
      documentId: entity.documentId,
      subjectType: entity.subjectType,
      subjectId: entity.subjectId,
      grantType: entity.grantType,
      grantedByType: entity.grantedByType,
      grantedById: entity.grantedById,
      createdAt: entity.createdAt,
      revokedAt: entity.revokedAt || undefined,
      revokedByType: entity.revokedByType || undefined,
      revokedById: entity.revokedById || undefined,
    };
  }
}

