import { ManagerOrganization } from '../entities/manager-organization.entity';

/**
 * Repository port for ManagerOrganization (Hexagonal Architecture)
 */
export abstract class ManagerOrganizationRepositoryPort {
  abstract findById(id: number): Promise<ManagerOrganization | null>;
  abstract findByName(name: string): Promise<ManagerOrganization | null>;
  abstract save(organization: ManagerOrganization): Promise<ManagerOrganization>;
  abstract update(
    id: number,
    updates: Partial<ManagerOrganization>,
  ): Promise<void>;
  abstract delete(id: number): Promise<void>;
  abstract findAllVerified(): Promise<ManagerOrganization[]>;
}






