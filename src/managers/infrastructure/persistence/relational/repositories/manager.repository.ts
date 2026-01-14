import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ManagerRepositoryPort } from '../../../../domain/repositories/manager.repository.port';
import { Manager } from '../../../../domain/entities/manager.entity';
import { ManagerEntity } from '../entities/manager.entity';

@Injectable()
export class ManagerRelationalRepository implements ManagerRepositoryPort {
  constructor(
    @InjectRepository(ManagerEntity)
    private readonly repository: Repository<ManagerEntity>,
  ) {}

  async findById(id: number): Promise<Manager | null> {
    const entity = await this.repository.findOne({
      where: { id, deletedAt: IsNull() },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByUserId(userId: number): Promise<Manager | null> {
    const entity = await this.repository.findOne({
      where: { userId, deletedAt: IsNull() },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async save(manager: Manager): Promise<Manager> {
    const entity = this.toEntity(manager);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async update(id: number, updates: Partial<Manager>): Promise<void> {
    await this.repository.update(id, updates);
  }

  async delete(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }

  async findAllVerified(): Promise<Manager[]> {
    const entities = await this.repository.find({
      where: {
        verificationStatus: 'verified',
        deletedAt: IsNull(),
      },
    });

    return entities.map((e) => this.toDomain(e));
  }

  private toDomain(entity: ManagerEntity): Manager {
    return {
      id: entity.id,
      userId: entity.userId,
      displayName: entity.displayName,
      legalName: entity.legalName,
      address: entity.address,
      latitude: entity.latitude ? Number(entity.latitude) : undefined,
      longitude: entity.longitude ? Number(entity.longitude) : undefined,
      phoneNumber: entity.phoneNumber,
      operatingHours: entity.operatingHours,
      timezone: entity.timezone,
      verificationStatus: entity.verificationStatus,
      verifiedAt: entity.verifiedAt,
      verifiedByAdminId: entity.verifiedByAdminId,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
    };
  }

  private toEntity(domain: Manager): ManagerEntity {
    const entity = new ManagerEntity();
    entity.id = domain.id;
    entity.userId = domain.userId;
    entity.displayName = domain.displayName;
    entity.legalName = domain.legalName;
    entity.address = domain.address;
    entity.latitude = domain.latitude;
    entity.longitude = domain.longitude;
    entity.phoneNumber = domain.phoneNumber;
    entity.operatingHours = domain.operatingHours;
    entity.timezone = domain.timezone;
    entity.verificationStatus = domain.verificationStatus;
    entity.verifiedAt = domain.verifiedAt;
    entity.verifiedByAdminId = domain.verifiedByAdminId;
    return entity;
  }
}
