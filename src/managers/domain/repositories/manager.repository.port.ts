import { Manager } from '../entities/manager.entity';

/**
 * Repository port for Manager (Hexagonal Architecture)
 */
export abstract class ManagerRepositoryPort {
  abstract findById(id: number): Promise<Manager | null>;
  abstract findByUserId(userId: number): Promise<Manager | null>;
  abstract save(manager: Manager): Promise<Manager>;
  abstract update(
    id: number,
    updates: Partial<Manager>,
  ): Promise<void>;
  abstract delete(id: number): Promise<void>;
  abstract findAllVerified(): Promise<Manager[]>;
}

