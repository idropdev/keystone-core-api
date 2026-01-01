import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ManagerInstanceRepositoryPort } from '../../../../domain/repositories/manager-instance.repository.port';
import { ManagerInstance } from '../../../../domain/entities/manager-instance.entity';
import { ManagerInstanceEntity } from '../entities/manager-instance.entity';

@Injectable()
export class ManagerInstanceRelationalRepository
  implements ManagerInstanceRepositoryPort
{
  constructor(
    @InjectRepository(ManagerInstanceEntity)
    private readonly repository: Repository<ManagerInstanceEntity>,
  ) {}

  async findById(id: number): Promise<ManagerInstance | null> {
    const entity = await this.repository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['organization'],
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByUserId(userId: number): Promise<ManagerInstance | null> {
    const entity = await this.repository.findOne({
      where: { userId, deletedAt: IsNull() },
      relations: ['organization'],
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByOrganizationId(
    organizationId: number,
  ): Promise<ManagerInstance[]> {
    const entities = await this.repository.find({
      where: { organizationId, deletedAt: IsNull() },
      relations: ['organization'],
    });

    return entities.map((e) => this.toDomain(e));
  }

  async save(instance: ManagerInstance): Promise<ManagerInstance> {
    const entity = this.toEntity(instance);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async update(id: number, updates: Partial<ManagerInstance>): Promise<void> {
    await this.repository.update(id, updates);
  }

  async delete(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }

  async findAllVerified(): Promise<ManagerInstance[]> {
    const entities = await this.repository.find({
      where: { deletedAt: IsNull() },
      relations: ['organization'],
    });

    // Filter to only verified organizations
    return entities
      .filter((e) => e.organization.verificationStatus === 'verified')
      .map((e) => this.toDomain(e));
  }

  private toDomain(entity: ManagerInstanceEntity): ManagerInstance {
    return {
      id: entity.id,
      organizationId: entity.organizationId,
      userId: entity.userId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
      displayName: entity.displayName,
      phone: entity.phone,
      operatingHours: entity.operatingHours,
    };
  }

  private toEntity(domain: ManagerInstance): ManagerInstanceEntity {
    const entity = new ManagerInstanceEntity();
    entity.id = domain.id;
    entity.organizationId = domain.organizationId;
    entity.userId = domain.userId;
    entity.displayName = domain.displayName;
    entity.phone = domain.phone;
    entity.operatingHours = domain.operatingHours;
    return entity;
  }
}
