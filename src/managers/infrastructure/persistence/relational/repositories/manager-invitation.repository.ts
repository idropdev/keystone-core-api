import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ManagerInvitationRepositoryPort } from '../../../../domain/repositories/manager-invitation.repository.port';
import { ManagerInvitation } from '../../../../domain/entities/manager-invitation.entity';
import { ManagerInvitationEntity } from '../entities/manager-invitation.entity';

@Injectable()
export class ManagerInvitationRelationalRepository
  implements ManagerInvitationRepositoryPort
{
  constructor(
    @InjectRepository(ManagerInvitationEntity)
    private readonly repository: Repository<ManagerInvitationEntity>,
  ) {}

  async findById(id: number): Promise<ManagerInvitation | null> {
    const entity = await this.repository.findOne({
      where: { id },
      relations: ['invitedByAdmin'],
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByToken(token: string): Promise<ManagerInvitation | null> {
    // Don't filter by status - we need to check status in the service layer
    // to return appropriate error messages (400 for accepted, 400 for expired, etc.)
    const entity = await this.repository.findOne({
      where: { token },
      relations: ['invitedByAdmin'],
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByEmail(email: string): Promise<ManagerInvitation | null> {
    const entity = await this.repository.findOne({
      where: { email, status: 'pending' },
      order: { createdAt: 'DESC' },
      relations: ['invitedByAdmin'],
    });

    return entity ? this.toDomain(entity) : null;
  }

  async save(invitation: ManagerInvitation): Promise<ManagerInvitation> {
    const entity = this.toEntity(invitation);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async update(
    id: number,
    updates: Partial<ManagerInvitation>,
  ): Promise<void> {
    await this.repository.update(id, updates);
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  private toDomain(entity: ManagerInvitationEntity): ManagerInvitation {
    return {
      id: entity.id,
      email: entity.email,
      displayName: entity.displayName,
      legalName: entity.legalName,
      address: entity.address,
      latitude: entity.latitude ? Number(entity.latitude) : undefined,
      longitude: entity.longitude ? Number(entity.longitude) : undefined,
      phoneNumber: entity.phoneNumber,
      invitedByAdminId: entity.invitedByAdminId,
      token: entity.token,
      expiresAt: entity.expiresAt,
      acceptedAt: entity.acceptedAt,
      status: entity.status,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private toEntity(domain: ManagerInvitation): ManagerInvitationEntity {
    const entity = new ManagerInvitationEntity();
    entity.id = domain.id;
    entity.email = domain.email;
    entity.displayName = domain.displayName;
    entity.legalName = domain.legalName;
    entity.address = domain.address;
    entity.latitude = domain.latitude;
    entity.longitude = domain.longitude;
    entity.phoneNumber = domain.phoneNumber;
    entity.invitedByAdminId = domain.invitedByAdminId;
    entity.token = domain.token;
    entity.expiresAt = domain.expiresAt;
    entity.acceptedAt = domain.acceptedAt;
    entity.status = domain.status;
    return entity;
  }
}
