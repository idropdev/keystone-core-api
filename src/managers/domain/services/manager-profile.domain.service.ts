import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ManagerRepositoryPort } from '../repositories/manager.repository.port';
import { Manager } from '../entities/manager.entity';
import { AuditService, AuthEventType } from '../../../audit/audit.service';

export interface UpdateManagerProfileData {
  displayName?: string;
  phoneNumber?: string;
  operatingHours?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

/**
 * Domain Service for Manager Profile Management
 * 
 * Handles manager self-service profile updates with restrictions:
 * - Cannot update verification status
 * 
 * HIPAA Requirement: Only verified managers can update profile
 */
@Injectable()
export class ManagerProfileDomainService {
  private readonly logger = new Logger(ManagerProfileDomainService.name);

  constructor(
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Update manager profile (Manager self-service, verified only)
   * 
   * Restrictions:
   * - Only verified managers can update
   * - Cannot update verification status
   */
  async updateManagerProfile(
    managerId: number,
    updates: UpdateManagerProfileData,
  ): Promise<Manager> {
    const manager = await this.managerRepository.findById(managerId);
    if (!manager) {
      throw new NotFoundException(
        `Manager with ID ${managerId} not found`,
      );
    }

    // Verify manager is verified
    this.logger.log(
      `[UPDATE PROFILE] Verification check: managerId=${managerId}, ` +
      `displayName="${manager.displayName}", ` +
      `verificationStatus="${manager.verificationStatus}", ` +
      `verifiedAt=${manager.verifiedAt || 'null'}, ` +
      `verifiedByAdminId=${manager.verifiedByAdminId || 'null'}`,
    );

    if (manager.verificationStatus !== 'verified') {
      this.logger.warn(
        `[UPDATE PROFILE] ❌ FORBIDDEN (403): Manager ${managerId} attempted to update profile but manager is not verified. ` +
        `Manager details: id=${manager.id}, displayName="${manager.displayName}", ` +
        `verificationStatus="${manager.verificationStatus}" (expected: "verified")`,
      );
      throw new ForbiddenException(
        'Manager must be verified before updating profile',
      );
    }

    this.logger.log(
      `[UPDATE PROFILE] ✅ Verification check passed: managerId=${manager.id} is verified. Proceeding with profile update.`,
    );

    // Update profile fields (allowed fields only)
    const updateData: Partial<Manager> = {};
    if (updates.displayName !== undefined) {
      updateData.displayName = updates.displayName;
    }
    if (updates.phoneNumber !== undefined) {
      updateData.phoneNumber = updates.phoneNumber;
    }
    if (updates.operatingHours !== undefined) {
      updateData.operatingHours = updates.operatingHours;
    }
    if (updates.address !== undefined) {
      updateData.address = updates.address;
    }
    if (updates.latitude !== undefined) {
      updateData.latitude = updates.latitude;
    }
    if (updates.longitude !== undefined) {
      updateData.longitude = updates.longitude;
    }
    if (updates.timezone !== undefined) {
      updateData.timezone = updates.timezone;
    }

    if (Object.keys(updateData).length > 0) {
      await this.managerRepository.update(manager.id, updateData);
      // Reload to get updated manager
      const updatedManager = await this.managerRepository.findById(manager.id);
      if (updatedManager) {
        return updatedManager;
      }
    }

    // Audit log
    this.auditService.logAuthEvent({
      userId: String(manager.userId),
      provider: 'manager-profile',
      event: AuthEventType.MANAGER_PROFILE_UPDATED as any,
      success: true,
      metadata: {
        managerId: manager.id,
        updatedFields: Object.keys(updates),
      },
    });

    this.logger.log(
      `Manager profile updated for manager ${managerId}`,
    );

    return manager;
  }

  /**
   * Get manager profile (Manager self-service)
   */
  async getManagerProfile(managerId: number): Promise<Manager> {
    const manager = await this.managerRepository.findById(managerId);
    if (!manager) {
      throw new NotFoundException(
        `Manager with ID ${managerId} not found`,
      );
    }

    return manager;
  }
}
