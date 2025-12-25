import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { UserManagerAssignmentRepository } from '../../infrastructure/persistence/user-manager-assignment.repository';
import { UserRepository } from '../../infrastructure/persistence/user.repository';
import { UserManagerAssignment } from '../entities/user-manager-assignment.entity';
import { CreateUserManagerAssignmentDto } from '../../dto/create-user-manager-assignment.dto';
import { RoleEnum } from '../../../roles/roles.enum';
import { AuditService, AuthEventType } from '../../../audit/audit.service';

/**
 * UserManagerAssignmentService
 * 
 * Handles user-manager assignment relationships.
 * 
 * Key Rules:
 * - Manager must have role 'manager' (RoleEnum.manager = 3)
 * - User cannot be assigned to themselves
 * - Assignments are soft-deleted (not hard deleted)
 * - All assignment changes are audit logged
 * 
 * HIPAA Compliance:
 * - No PHI in logs
 * - All assignment changes audited
 */
@Injectable()
export class UserManagerAssignmentService {
  constructor(
    private readonly assignmentRepository: UserManagerAssignmentRepository,
    private readonly userRepository: UserRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Assign a user to a manager
   * 
   * Validation:
   * - Manager must exist and have role 'manager'
   * - User must exist
   * - User cannot be assigned to themselves
   * - Assignment must not already exist
   * 
   * @param dto - Assignment creation data
   * @param assignedById - ID of user creating the assignment (admin)
   * @returns Created UserManagerAssignment
   */
  async assignUserToManager(
    dto: CreateUserManagerAssignmentDto,
    assignedById: number,
  ): Promise<UserManagerAssignment> {
    // 1. Validate user exists
    const user = await this.userRepository.findById(dto.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // 2. Validate manager exists
    const manager = await this.userRepository.findById(dto.managerId);
    if (!manager) {
      throw new NotFoundException('Manager not found');
    }

    // 3. Validate manager has role 'manager'
    if (!manager.role || manager.role.id !== RoleEnum.manager) {
      throw new BadRequestException(
        'User does not have manager role. Only users with manager role can be assigned as managers.',
      );
    }

    // 4. Validate user is not assigning themselves
    if (dto.userId === dto.managerId) {
      throw new BadRequestException(
        'User cannot be assigned to themselves',
      );
    }

    // 5. Check if assignment already exists
    const existingAssignment = await this.assignmentRepository.findActive(
      dto.userId,
      dto.managerId,
    );

    if (existingAssignment) {
      throw new BadRequestException(
        'Assignment already exists between this user and manager',
      );
    }

    // 6. Create assignment
    const assignment = await this.assignmentRepository.create({
      userId: dto.userId,
      managerId: dto.managerId,
      assignedAt: new Date(),
      assignedById: assignedById || dto.assignedById,
    });

    // 7. Audit log
    this.auditService.logAuthEvent({
      userId: String(assignedById),
      provider: 'internal',
      event: AuthEventType.MANAGER_ASSIGNMENT_CREATED,
      success: true,
      metadata: {
        userId: dto.userId,
        managerId: dto.managerId,
        assignedById,
      },
    });

    return assignment;
  }

  /**
   * Remove assignment between user and manager
   * 
   * @param userId - User ID
   * @param managerId - Manager ID
   * @param removedById - ID of user removing the assignment (admin)
   */
  async removeAssignment(
    userId: number,
    managerId: number,
    removedById: number,
  ): Promise<void> {
    // 1. Check if assignment exists
    const assignment = await this.assignmentRepository.findActive(
      userId,
      managerId,
    );

    if (!assignment) {
      throw new NotFoundException(
        'Assignment not found between this user and manager',
      );
    }

    // 2. Soft delete assignment
    await this.assignmentRepository.softDelete(userId, managerId);

    // 3. Audit log
    this.auditService.logAuthEvent({
      userId: String(removedById),
      provider: 'internal',
      event: AuthEventType.MANAGER_ASSIGNMENT_REMOVED,
      success: true,
      metadata: {
        userId,
        managerId,
        removedById,
      },
    });
  }

  /**
   * Check if a manager is assigned to a user
   * 
   * @param managerId - Manager ID
   * @param userId - User ID
   * @returns true if assignment exists, false otherwise
   */
  async isManagerAssignedToUser(
    managerId: number,
    userId: number,
  ): Promise<boolean> {
    const assignment = await this.assignmentRepository.findActive(
      userId,
      managerId,
    );

    return !!assignment;
  }

  /**
   * Get all user IDs assigned to a manager
   * 
   * @param managerId - Manager ID
   * @returns Array of user IDs
   */
  async getAssignedUserIds(managerId: number): Promise<number[]> {
    const assignments = await this.assignmentRepository.findByManagerId(
      managerId,
    );

    return assignments.map((assignment) => assignment.userId);
  }

  /**
   * Get all manager IDs assigned to a user
   * 
   * @param userId - User ID
   * @returns Array of manager IDs
   */
  async getAssignedManagerIds(userId: number): Promise<number[]> {
    const assignments = await this.assignmentRepository.findByUserId(userId);

    return assignments.map((assignment) => assignment.managerId);
  }

  /**
   * Get all assignments for a manager
   * 
   * @param managerId - Manager ID
   * @returns Array of UserManagerAssignments
   */
  async getAssignmentsByManager(
    managerId: number,
  ): Promise<UserManagerAssignment[]> {
    return this.assignmentRepository.findByManagerId(managerId);
  }

  /**
   * Get all assignments for a user
   * 
   * @param userId - User ID
   * @returns Array of UserManagerAssignments
   */
  async getAssignmentsByUser(
    userId: number,
  ): Promise<UserManagerAssignment[]> {
    return this.assignmentRepository.findByUserId(userId);
  }
}

