import { ManagerInvitation } from '../entities/manager-invitation.entity';

/**
 * Repository port for ManagerInvitation (Hexagonal Architecture)
 */
export abstract class ManagerInvitationRepositoryPort {
  abstract findById(id: number): Promise<ManagerInvitation | null>;
  abstract findByToken(token: string): Promise<ManagerInvitation | null>;
  abstract findByEmail(email: string): Promise<ManagerInvitation | null>;
  abstract save(invitation: ManagerInvitation): Promise<ManagerInvitation>;
  abstract update(id: number, updates: Partial<ManagerInvitation>): Promise<void>;
  abstract delete(id: number): Promise<void>;
}






