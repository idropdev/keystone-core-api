import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ManagerInvitationRepositoryPort } from '../repositories/manager-invitation.repository.port';
import { ManagerInvitation } from '../entities/manager-invitation.entity';
import { ManagerRepositoryPort } from '../repositories/manager.repository.port';
import { Manager } from '../entities/manager.entity';
import { AuditService, AuthEventType } from '../../../audit/audit.service';
import { UsersService } from '../../../users/users.service';
import { CreateUserDto } from '../../../users/dto/create-user.dto';
import { RoleEnum } from '../../../roles/roles.enum';
import { AllConfigType } from '../../../config/config.type';

export interface InviteManagerData {
  email: string;
  displayName: string; // REQUIRED
  legalName?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  phoneNumber?: string;
  invitedByAdminId: number;
}

export interface AcceptInvitationData {
  token: string;
  user: {
    firstName: string;
    lastName: string;
    password: string;
  };
  managerProfile?: {
    displayName?: string;
    location?: {
      address?: string;
      city?: string;
      state?: string;
      country?: string;
      zip?: string;
    };
    identifiers?: {
      npi?: string;
      clia?: string;
    };
  };
}

/**
 * Domain Service for Manager Onboarding
 *
 * Handles the complete manager onboarding lifecycle:
 * 1. Admin invites manager (with identity fields)
 * 2. Manager accepts invitation
 * 3. Manager creates profile
 * 4. Manager created with pending verification status
 * 5. Admin verifies manager
 *
 * HIPAA Requirement: Managers cannot access documents until verified
 */
@Injectable()
export class ManagerOnboardingDomainService {
  private readonly logger = new Logger(ManagerOnboardingDomainService.name);
  private readonly invitationExpirationDays: number;

  constructor(
    @Inject('ManagerInvitationRepositoryPort')
    private readonly invitationRepository: ManagerInvitationRepositoryPort,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
    private readonly auditService: AuditService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    // Default to 7 days expiration for invitations
    // TODO: Add managerInvitationExpirationDays to app config
    this.invitationExpirationDays = 7;
  }

  /**
   * Invite a manager (Admin only)
   *
   * Creates a ManagerInvitation with a secure, one-time token and manager identity fields
   */
  async inviteManager(data: InviteManagerData): Promise<ManagerInvitation> {
    // Validate required fields
    if (!data.displayName || data.displayName.trim().length === 0) {
      throw new BadRequestException('displayName is required');
    }

    // Validate location (at least one required)
    if (!data.address && (!data.latitude || !data.longitude)) {
      throw new BadRequestException(
        'At least one location method required: address OR (latitude AND longitude)',
      );
    }

    // Check for existing pending invitation
    const existingInvitation = await this.invitationRepository.findByEmail(
      data.email,
    );
    if (existingInvitation && existingInvitation.status === 'pending') {
      throw new BadRequestException(
        'An invitation already exists for this email address',
      );
    }

    // Generate secure token (crypto-secure, one-time use)
    const token = this.generateInvitationToken();

    // Set expiration (default 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.invitationExpirationDays);

    // Create invitation with manager identity fields
    const invitation = new ManagerInvitation();
    invitation.email = data.email;
    invitation.displayName = data.displayName;
    invitation.legalName = data.legalName;
    invitation.address = data.address;
    invitation.latitude = data.latitude;
    invitation.longitude = data.longitude;
    invitation.phoneNumber = data.phoneNumber;
    invitation.invitedByAdminId = data.invitedByAdminId;
    invitation.token = token;
    invitation.expiresAt = expiresAt;
    invitation.status = 'pending';
    invitation.createdAt = new Date();
    invitation.updatedAt = new Date();

    const savedInvitation = await this.invitationRepository.save(invitation);

    // Audit log
    this.auditService.logAuthEvent({
      userId: String(data.invitedByAdminId),
      provider: 'manager-onboarding',
      event: AuthEventType.MANAGER_INVITED as any,
      success: true,
      metadata: {
        invitationId: savedInvitation.id,
        displayName: data.displayName,
        email: data.email, // Email is not PHI in this context (invitation)
      },
    });

    // TODO: Send invitation email with token
    // await this.mailService.sendManagerInvitation({
    //   email: data.email,
    //   token,
    //   displayName: data.displayName,
    //   expiresAt,
    // });

    this.logger.log(
      `Manager invitation created for ${data.email} (displayName: ${data.displayName})`,
    );

    return savedInvitation;
  }

  /**
   * Accept invitation and create manager profile
   *
   * Creates User (role = manager) and Manager (status = pending)
   */
  async acceptInvitation(
    data: AcceptInvitationData,
  ): Promise<{ user: any; manager: Manager }> {
    // Find and validate invitation
    const invitation = await this.invitationRepository.findByToken(data.token);
    if (!invitation) {
      throw new NotFoundException('Invalid or expired invitation token');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException(
        `Invitation has already been ${invitation.status}`,
      );
    }

    if (new Date() > invitation.expiresAt) {
      // Mark as expired
      await this.invitationRepository.update(invitation.id, {
        status: 'expired',
      });
      throw new BadRequestException('Invitation has expired');
    }

    // Audit: Onboarding started
    this.auditService.logAuthEvent({
      userId: invitation.email, // Email used as identifier before user creation
      provider: 'manager-onboarding',
      event: AuthEventType.MANAGER_ONBOARDING_STARTED as any,
      success: true,
      metadata: {
        invitationId: invitation.id,
        displayName: invitation.displayName,
      },
    });

    // Validate required user data
    if (
      !data.user ||
      !data.user.password ||
      !data.user.firstName ||
      !data.user.lastName
    ) {
      throw new BadRequestException(
        'Missing required user data: password, firstName, and lastName are required',
      );
    }

    // Create User with manager role
    const createUserDto: CreateUserDto = {
      email: invitation.email,
      password: data.user.password,
      firstName: data.user.firstName,
      lastName: data.user.lastName,
      role: { id: RoleEnum.manager },
      provider: 'email',
    };

    const user = await this.usersService.create(createUserDto);

    // Create Manager with identity from invitation
    const manager = new Manager();
    manager.userId =
      typeof user.id === 'number' ? user.id : parseInt(String(user.id), 10);
    manager.displayName = invitation.displayName;
    manager.legalName = invitation.legalName;
    manager.address = invitation.address;
    manager.latitude = invitation.latitude;
    manager.longitude = invitation.longitude;
    manager.phoneNumber = invitation.phoneNumber;
    manager.verificationStatus = 'pending';
    manager.createdAt = new Date();
    manager.updatedAt = new Date();

    // Allow profile updates from acceptance data (optional)
    if (data.managerProfile) {
      if (data.managerProfile.displayName) {
        manager.displayName = data.managerProfile.displayName;
      }
      if (data.managerProfile.location?.address) {
        manager.address = data.managerProfile.location.address;
      }
    }

    const savedManager = await this.managerRepository.save(manager);

    // Mark invitation as accepted
    await this.invitationRepository.update(invitation.id, {
      status: 'accepted',
      acceptedAt: new Date(),
    });

    // Audit: Onboarding completed
    this.auditService.logAuthEvent({
      userId: String(user.id),
      provider: 'manager-onboarding',
      event: AuthEventType.MANAGER_ONBOARDING_COMPLETED as any,
      success: true,
      metadata: {
        invitationId: invitation.id,
        managerId: savedManager.id,
        displayName: savedManager.displayName,
      },
    });

    this.logger.log(
      `Manager onboarding completed for user ${user.id} (manager: ${savedManager.id})`,
    );

    return { user, manager: savedManager };
  }

  /**
   * Validate invitation token (Public)
   */
  async validateInvitation(token: string): Promise<{
    displayName: string;
    expiresAt: Date;
    status: string;
  }> {
    const invitation = await this.invitationRepository.findByToken(token);

    if (!invitation) {
      throw new NotFoundException('Invalid or expired invitation token');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException(
        `Invitation has already been ${invitation.status}`,
      );
    }

    if (new Date() > invitation.expiresAt) {
      // Mark as expired
      await this.invitationRepository.update(invitation.id, {
        status: 'expired',
      });
      throw new BadRequestException('Invitation has expired');
    }

    return {
      displayName: invitation.displayName,
      expiresAt: invitation.expiresAt,
      status: invitation.status,
    };
  }

  /**
   * Verify manager (Admin only)
   *
   * Sets manager verification_status = 'verified'
   */
  async verifyManager(adminId: number, managerId: number): Promise<Manager> {
    this.logger.log(
      `[VERIFY MANAGER] Starting verification: adminId=${adminId}, managerId=${managerId}`,
    );

    const manager = await this.managerRepository.findById(managerId);
    if (!manager) {
      this.logger.error(
        `[VERIFY MANAGER] ❌ Manager not found: managerId=${managerId}`,
      );
      throw new NotFoundException(`Manager with ID ${managerId} not found`);
    }

    this.logger.debug(
      `[VERIFY MANAGER] Manager found: managerId=${manager.id}, ` +
        `userId=${manager.userId}, verificationStatus="${manager.verificationStatus}"`,
    );

    this.logger.log(
      `[VERIFY MANAGER] Current manager state: managerId=${manager.id}, ` +
        `displayName="${manager.displayName}", verificationStatus="${manager.verificationStatus}", ` +
        `verifiedAt=${manager.verifiedAt || 'null'}, verifiedByAdminId=${manager.verifiedByAdminId || 'null'}`,
    );

    // Allow re-verification if status is 'suspended' (manager was suspended then re-verified)
    // Only block if already 'verified'
    if (manager.verificationStatus === 'verified') {
      this.logger.warn(
        `[VERIFY MANAGER] Manager ${manager.id} is already verified`,
      );
      throw new BadRequestException('Manager is already verified');
    }

    // Log if we're re-verifying a suspended manager
    if (manager.verificationStatus === 'suspended') {
      this.logger.log(
        `[VERIFY MANAGER] Re-verifying suspended manager: managerId=${manager.id}, ` +
          `currentStatus="suspended", will change to "verified"`,
      );
    }

    // Update manager verification status
    this.logger.log(
      `[VERIFY MANAGER] Updating manager verification status: managerId=${manager.id}, ` +
        `from "${manager.verificationStatus}" → "verified", verifiedByAdminId=${adminId}`,
    );
    await this.managerRepository.update(manager.id, {
      verificationStatus: 'verified',
      verifiedAt: new Date(),
      verifiedByAdminId: adminId,
    });

    // Verify the update was successful by reloading the manager
    this.logger.debug(
      `[VERIFY MANAGER] Reloading manager to verify update: managerId=${manager.id}`,
    );
    const updatedManager = await this.managerRepository.findById(manager.id);
    if (!updatedManager) {
      this.logger.error(
        `[VERIFY MANAGER] ❌ Manager not found after update: managerId=${manager.id}`,
      );
      throw new NotFoundException(
        `Manager with ID ${manager.id} not found after update`,
      );
    }

    this.logger.log(
      `[VERIFY MANAGER] Manager reloaded after update: managerId=${updatedManager.id}, ` +
        `verificationStatus="${updatedManager.verificationStatus}", ` +
        `verifiedAt=${updatedManager.verifiedAt || 'null'}, ` +
        `verifiedByAdminId=${updatedManager.verifiedByAdminId || 'null'}`,
    );

    if (updatedManager.verificationStatus !== 'verified') {
      this.logger.error(
        `[VERIFY MANAGER] ❌ VERIFICATION FAILED: Manager ${manager.id} verification status update failed. ` +
          `Expected 'verified', got '${updatedManager.verificationStatus}'`,
      );
      throw new Error(
        `Failed to update manager verification status. Current status: ${updatedManager.verificationStatus}`,
      );
    }

    this.logger.log(
      `[VERIFY MANAGER] ✅ SUCCESS: Manager ${manager.id} successfully verified. ` +
        `Status: "${updatedManager.verificationStatus}", verifiedAt: ${updatedManager.verifiedAt}, ` +
        `verifiedByAdminId: ${updatedManager.verifiedByAdminId}`,
    );

    // Audit log
    this.auditService.logAuthEvent({
      userId: String(adminId),
      provider: 'manager-onboarding',
      event: AuthEventType.MANAGER_VERIFIED,
      success: true,
      metadata: {
        managerId: manager.id,
        displayName: manager.displayName,
      },
    });

    this.logger.log(`Manager ${managerId} verified by admin ${adminId}`);

    return updatedManager;
  }

  /**
   * Suspend manager (Admin only)
   *
   * Disables all access, prevents new documents
   */
  async suspendManager(
    adminId: number,
    managerId: number,
    reason: string,
  ): Promise<Manager> {
    this.logger.log(
      `[SUSPEND MANAGER] Starting suspension: adminId=${adminId}, managerId=${managerId}, reason="${reason}"`,
    );

    const manager = await this.managerRepository.findById(managerId);
    if (!manager) {
      this.logger.error(
        `[SUSPEND MANAGER] ❌ Manager not found: managerId=${managerId}`,
      );
      throw new NotFoundException(`Manager with ID ${managerId} not found`);
    }

    this.logger.log(
      `[SUSPEND MANAGER] Current manager state: managerId=${manager.id}, ` +
        `displayName="${manager.displayName}", verificationStatus="${manager.verificationStatus}", ` +
        `will change to "suspended"`,
    );

    // Update manager verification status to suspended
    await this.managerRepository.update(manager.id, {
      verificationStatus: 'suspended',
    });

    // Verify the update
    const updatedManager = await this.managerRepository.findById(manager.id);
    this.logger.log(
      `[SUSPEND MANAGER] Manager updated: managerId=${updatedManager?.id}, ` +
        `verificationStatus="${updatedManager?.verificationStatus}"`,
    );

    // Audit log
    this.auditService.logAuthEvent({
      userId: String(adminId),
      provider: 'manager-onboarding',
      event: AuthEventType.MANAGER_SUSPENDED,
      success: true,
      metadata: {
        managerId: manager.id,
        displayName: manager.displayName,
        reason: reason.substring(0, 200), // Truncate reason
      },
    });

    this.logger.warn(
      `[SUSPEND MANAGER] ✅ Manager ${managerId} suspended by admin ${adminId}: ${reason}`,
    );

    if (!updatedManager) {
      throw new NotFoundException(
        `Manager with ID ${managerId} not found after update`,
      );
    }
    return updatedManager;
  }

  /**
   * Generate secure invitation token
   *
   * Uses crypto.randomBytes for cryptographically secure token generation
   */
  private generateInvitationToken(): string {
    // Generate 32 bytes (256 bits) of random data, encode as base64url
    const randomBytes = crypto.randomBytes(32);
    return randomBytes.toString('base64url');
  }
}
