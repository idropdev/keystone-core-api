import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ManagerOrganizationRepositoryPort } from '../../../../domain/repositories/manager-organization.repository.port';
import { ManagerOrganization } from '../../../../domain/entities/manager-organization.entity';
import { ManagerOrganizationEntity } from '../entities/manager-organization.entity';

@Injectable()
export class ManagerOrganizationRelationalRepository
  implements ManagerOrganizationRepositoryPort
{
  private readonly logger = new Logger(
    ManagerOrganizationRelationalRepository.name,
  );

  constructor(
    @InjectRepository(ManagerOrganizationEntity)
    private readonly repository: Repository<ManagerOrganizationEntity>,
  ) {}

  async findById(id: number): Promise<ManagerOrganization | null> {
    this.logger.debug(
      `[FIND BY ID] Querying organization with raw SQL (bypassing cache): organizationId=${id}`,
    );

    // Use raw SQL query to completely bypass entity manager cache
    // This ensures we always get the latest data from the database
    // This is critical after updates to ensure we see the latest verification status
    const raw = await this.repository.manager.query(
      `SELECT 
        id,
        name,
        verification_status as "verificationStatus",
        verified_at as "verifiedAt",
        verified_by as "verifiedById",
        created_at as "createdAt",
        updated_at as "updatedAt",
        deleted_at as "deletedAt"
      FROM manager_organizations
      WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );

    if (!raw || raw.length === 0) {
      this.logger.debug(
        `[FIND BY ID] Organization not found: organizationId=${id}`,
      );
      return null;
    }

    const row = raw[0];

    // Map raw data to entity
    const entity = new ManagerOrganizationEntity();
    entity.id = row.id;
    entity.name = row.name;
    entity.verificationStatus = row.verificationStatus;
    entity.verifiedAt = row.verifiedAt;
    entity.verifiedById = row.verifiedById;
    entity.createdAt = row.createdAt;
    entity.updatedAt = row.updatedAt;
    entity.deletedAt = row.deletedAt;

    const domain = this.toDomain(entity);

    this.logger.log(
      `[FIND BY ID] Organization retrieved (raw SQL): id=${domain.id}, ` +
      `name="${domain.name}", verificationStatus="${domain.verificationStatus}", ` +
      `verifiedAt=${domain.verifiedAt ? domain.verifiedAt.toISOString() : 'null'}, ` +
      `verifiedById=${domain.verifiedById || 'null'}, ` +
      `updatedAt=${domain.updatedAt ? domain.updatedAt.toISOString() : 'null'}`,
    );

    return domain;
  }

  async findByName(name: string): Promise<ManagerOrganization | null> {
    const entity = await this.repository.findOne({
      where: { name, deletedAt: IsNull() },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async save(
    organization: ManagerOrganization,
  ): Promise<ManagerOrganization> {
    const entity = this.toEntity(organization);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async update(
    id: number,
    updates: Partial<ManagerOrganization>,
  ): Promise<void> {
    this.logger.log(
      `[UPDATE] Starting organization update: organizationId=${id}, updates=${JSON.stringify(updates)}`,
    );

    // Load the existing entity
    const existing = await this.repository.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!existing) {
      this.logger.error(
        `[UPDATE] Organization not found: organizationId=${id}`,
      );
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    this.logger.debug(
      `[UPDATE] Existing organization: id=${existing.id}, name="${existing.name}", ` +
      `verificationStatus="${existing.verificationStatus}", verifiedAt=${existing.verifiedAt || 'null'}, ` +
      `verifiedById=${existing.verifiedById || 'null'}`,
    );

    // Apply updates directly to the entity properties
    // TypeORM will handle property-to-column mapping when we save
    if (updates.verificationStatus !== undefined) {
      this.logger.log(
        `[UPDATE] Updating verificationStatus: "${existing.verificationStatus}" → "${updates.verificationStatus}"`,
      );
      existing.verificationStatus = updates.verificationStatus;
    }
    if (updates.verifiedAt !== undefined) {
      this.logger.debug(
        `[UPDATE] Updating verifiedAt: ${existing.verifiedAt || 'null'} → ${updates.verifiedAt}`,
      );
      existing.verifiedAt = updates.verifiedAt;
    }
    if (updates.verifiedById !== undefined) {
      this.logger.debug(
        `[UPDATE] Updating verifiedById: ${existing.verifiedById || 'null'} → ${updates.verifiedById}`,
      );
      existing.verifiedById = updates.verifiedById;
    }
    if (updates.name !== undefined) {
      this.logger.debug(
        `[UPDATE] Updating name: "${existing.name}" → "${updates.name}"`,
      );
      existing.name = updates.name;
    }

    // Use save() which properly handles property-to-column mapping
    // This is the most reliable method and ensures immediate persistence
    // Note: In test environments, ensure transactions are properly committed
    // The findById() method uses raw SQL queries to bypass entity cache and get fresh data
    await this.repository.save(existing);

    this.logger.log(
      `[UPDATE] Organization saved successfully: organizationId=${id}, ` +
      `verificationStatus="${existing.verificationStatus}", verifiedAt=${existing.verifiedAt || 'null'}, ` +
      `verifiedById=${existing.verifiedById || 'null'}`,
    );
  }

  async delete(id: number): Promise<void> {
    await this.repository.softDelete(id);
  }

  async findAllVerified(): Promise<ManagerOrganization[]> {
    const entities = await this.repository.find({
      where: {
        verificationStatus: 'verified',
        deletedAt: IsNull(),
      },
    });

    return entities.map((e) => this.toDomain(e));
  }

  private toDomain(entity: ManagerOrganizationEntity): ManagerOrganization {
    return {
      id: entity.id,
      name: entity.name,
      verificationStatus: entity.verificationStatus,
      verifiedAt: entity.verifiedAt,
      verifiedById: entity.verifiedById,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt,
    };
  }

  private toEntity(
    domain: ManagerOrganization,
  ): ManagerOrganizationEntity {
    const entity = new ManagerOrganizationEntity();
    entity.id = domain.id;
    entity.name = domain.name;
    entity.verificationStatus = domain.verificationStatus;
    entity.verifiedAt = domain.verifiedAt;
    entity.verifiedById = domain.verifiedById;
    return entity;
  }
}

