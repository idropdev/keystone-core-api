import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { UserManagerAssignmentEntity } from '../entities/user-manager-assignment.entity';
import { UserManagerAssignmentRepository } from '../../user-manager-assignment.repository';
import { UserManagerAssignment } from '../../../../domain/entities/user-manager-assignment.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';

@Injectable()
export class UserManagerAssignmentRelationalRepository
  implements UserManagerAssignmentRepository
{
  constructor(
    @InjectRepository(UserManagerAssignmentEntity)
    private readonly repository: Repository<UserManagerAssignmentEntity>,
  ) {}

  async findActive(
    userId: number,
    managerId: number,
  ): Promise<NullableType<UserManagerAssignment>> {
    const entity = await this.repository.findOne({
      where: {
        userId,
        managerId,
        deletedAt: IsNull(),
      },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByUserId(userId: number): Promise<UserManagerAssignment[]> {
    const entities = await this.repository.find({
      where: {
        userId,
        deletedAt: IsNull(),
      },
      relations: ['manager', 'assignedBy'],
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async findByManagerId(managerId: number): Promise<UserManagerAssignment[]> {
    const entities = await this.repository.find({
      where: {
        managerId,
        deletedAt: IsNull(),
      },
      relations: ['user', 'assignedBy'],
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async create(
    data: Omit<
      UserManagerAssignment,
      'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
    >,
  ): Promise<UserManagerAssignment> {
    const entity = this.repository.create({
      userId: data.userId,
      managerId: data.managerId,
      assignedAt: data.assignedAt,
      assignedById: data.assignedById,
    });

    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async softDelete(userId: number, managerId: number): Promise<void> {
    await this.repository.softDelete({
      userId,
      managerId,
      deletedAt: IsNull(),
    });
  }

  async exists(userId: number, managerId: number): Promise<boolean> {
    const count = await this.repository.count({
      where: {
        userId,
        managerId,
        deletedAt: IsNull(),
      },
    });

    return count > 0;
  }

  private toDomain(entity: UserManagerAssignmentEntity): UserManagerAssignment {
    return {
      id: entity.id,
      userId: entity.userId,
      managerId: entity.managerId,
      assignedAt: entity.assignedAt,
      assignedById: entity.assignedById,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      deletedAt: entity.deletedAt || undefined,
    };
  }
}

