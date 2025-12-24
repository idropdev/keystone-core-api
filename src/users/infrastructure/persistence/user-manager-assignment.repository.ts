import { NullableType } from '../../utils/types/nullable.type';
import { UserManagerAssignment } from '../../domain/entities/user-manager-assignment.entity';

export abstract class UserManagerAssignmentRepository {
  /**
   * Find active assignment between user and manager
   */
  abstract findActive(
    userId: number,
    managerId: number,
  ): Promise<NullableType<UserManagerAssignment>>;

  /**
   * Find all active assignments for a user
   */
  abstract findByUserId(userId: number): Promise<UserManagerAssignment[]>;

  /**
   * Find all active assignments for a manager
   */
  abstract findByManagerId(managerId: number): Promise<UserManagerAssignment[]>;

  /**
   * Create a new assignment
   */
  abstract create(
    data: Omit<
      UserManagerAssignment,
      'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
    >,
  ): Promise<UserManagerAssignment>;

  /**
   * Soft delete an assignment
   */
  abstract softDelete(userId: number, managerId: number): Promise<void>;

  /**
   * Check if assignment exists (active)
   */
  abstract exists(userId: number, managerId: number): Promise<boolean>;
}

