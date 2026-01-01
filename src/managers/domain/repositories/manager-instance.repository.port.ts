import { ManagerInstance } from '../entities/manager-instance.entity';

/**
 * Repository port for ManagerInstance (Hexagonal Architecture)
 */
export abstract class ManagerInstanceRepositoryPort {
  abstract findById(id: number): Promise<ManagerInstance | null>;
  abstract findByUserId(userId: number): Promise<ManagerInstance | null>;
  abstract findByOrganizationId(
    organizationId: number,
  ): Promise<ManagerInstance[]>;
  abstract save(instance: ManagerInstance): Promise<ManagerInstance>;
  abstract update(id: number, updates: Partial<ManagerInstance>): Promise<void>;
  abstract delete(id: number): Promise<void>;
  abstract findAllVerified(): Promise<ManagerInstance[]>;
}
