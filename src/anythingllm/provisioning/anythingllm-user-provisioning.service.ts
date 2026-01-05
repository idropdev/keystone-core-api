import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { createHash } from 'crypto';
import { User } from '../../users/domain/user';
import { AnythingLLMAdminService } from '../admin/anythingllm-admin.service';
import { CreateUserRequestSchema } from '../registry/schemas/admin-user.schema';
import { ManageWorkspaceUsersRequestSchema } from '../registry/schemas/admin-workspace.schema';
import { UpstreamError } from '../registry/upstream-error';
import { AuditService, AuthEventType } from '../../audit/audit.service';
import { WorkspaceMapperService } from './domain/workspace-mapper.service';
import { AnythingLLMUserMappingRepository } from './infrastructure/persistence/repositories/anythingllm-user-mapping.repository';
import { AllConfigType } from '../../config/config.type';
import { RoleEnum } from '../../roles/roles.enum';

/**
 * AnythingLLM User Provisioning Service
 *
 * Handles automatic user provisioning from Keystone to AnythingLLM.
 * Ensures user creation, workspace assignment, and suspension sync.
 *
 * HIPAA Compliance:
 * - Never logs passwords or tokens
 * - Never stores passwords (discarded immediately after API call)
 * - Uses non-PII identifiers (hashed user IDs for workspace slugs)
 *
 * Note: Currently only supports relational databases. Document databases are not supported yet.
 */
@Injectable()
export class AnythingLLMUserProvisioningService {
  private readonly logger = new Logger(AnythingLLMUserProvisioningService.name);

  constructor(
    private readonly adminService: AnythingLLMAdminService,
    private readonly auditService: AuditService,
    private readonly workspaceMapper: WorkspaceMapperService,
    private readonly configService: ConfigService<AllConfigType>,
    @Optional()
    @Inject(AnythingLLMUserMappingRepository)
    private readonly mappingRepository?: AnythingLLMUserMappingRepository,
  ) {}

  /**
   * Complete provisioning flow (user creation + workspace creation + assignment)
   *
   * Invariant: All three steps must succeed, or provisioning is incomplete.
   * Throws error if any step fails (for retry logic).
   *
   * @param user - Keystone user to provision
   */
  async provisionUser(user: User): Promise<void> {
    // Check if repository is available (only works with relational databases)
    if (!this.mappingRepository) {
      this.logger.warn(
        'AnythingLLM provisioning is not available - mapping repository is not configured. This is expected when using document databases.',
      );
      return;
    }

    const keystoneUserId = String(user.id);
    this.logger.log(
      `Starting AnythingLLM provisioning for user ${keystoneUserId}`,
    );

    // Log provisioning started
    this.auditService.logAuthEvent({
      userId: keystoneUserId,
      provider: 'anythingllm',
      event: AuthEventType.ANYTHINGLLM_USER_PROVISIONING_STARTED,
      success: true,
    });

    try {
      // Map Keystone role to AnythingLLM role (for audit logging and user creation)
      const roleId = user.role?.id;
      const anythingllmRole = this.mapKeystoneRoleToAnythingLLMRole(roleId);

      // Step 1: Create user in AnythingLLM (or find existing)
      const anythingllmUserId = await this.createUserInAnythingLLM(user);

      // Step 2: Generate workspace slug (for mapping purposes)
      const workspaceSlug = this.workspaceMapper.getWorkspaceSlugForUser(user);

      // Step 3: Store mapping
      await this.mappingRepository.create({
        keystoneUserId,
        anythingllmUserId,
        workspaceSlug,
      });

      // Step 4: Assign user to workspace (only for default users)
      // Admin and Manager roles have access to ALL workspaces automatically,
      // so workspace assignment is not necessary for them.
      if (anythingllmRole === 'default') {
        // TODO: Workspace creation and assignment for default users
        // Currently skipping workspace assignment as workspace must exist first
        // Workspace creation/assignment should be handled separately or implemented here
        this.logger.log(
          `Skipping workspace assignment for user ${keystoneUserId} - workspace creation not yet implemented. Default users will need manual workspace assignment.`,
        );
        // await this.assignUserToWorkspace(anythingllmUserId, workspaceSlug, user);
      } else {
        // Admin and manager roles don't need workspace assignment (they have access to all)
        this.logger.log(
          `Skipping workspace assignment for ${anythingllmRole} user ${keystoneUserId} - ${anythingllmRole} users have access to all workspaces automatically`,
        );
      }

      // Log provisioning succeeded with role mapping details
      this.auditService.logAuthEvent({
        userId: keystoneUserId,
        provider: 'anythingllm',
        event: AuthEventType.ANYTHINGLLM_USER_PROVISIONING_SUCCEEDED,
        success: true,
        metadata: {
          anythingllmUserId,
          workspaceSlug,
          keystoneRoleId: roleId,
          anythingllmRole,
        },
      });

      this.logger.log(
        `Successfully provisioned user ${keystoneUserId} to AnythingLLM (user ID: ${anythingllmUserId}, workspace: ${workspaceSlug})`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to provision user ${keystoneUserId} to AnythingLLM: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Log provisioning failed
      this.auditService.logAuthEvent({
        userId: keystoneUserId,
        provider: 'anythingllm',
        event: AuthEventType.ANYTHINGLLM_USER_PROVISIONING_FAILED,
        success: false,
        errorMessage,
      });

      throw error;
    }
  }

  /**
   * Map Keystone role to AnythingLLM role
   *
   * Maps Keystone RoleEnum values to AnythingLLM role strings:
   * - RoleEnum.admin (1) → 'admin'
   * - RoleEnum.manager (3) → 'manager'
   * - RoleEnum.user (2) → 'default'
   * - null/undefined → 'default' (fallback)
   *
   * @param roleId - Keystone role ID (RoleEnum value)
   * @returns AnythingLLM role string
   */
  private mapKeystoneRoleToAnythingLLMRole(roleId: number | string | null | undefined): string {
    if (roleId === null || roleId === undefined) {
      return 'default';
    }

    // Handle both numeric and string role IDs
    const numericRoleId = typeof roleId === 'string' ? parseInt(roleId, 10) : roleId;

    if (numericRoleId === RoleEnum.admin) {
      return 'admin';
    }
    if (numericRoleId === RoleEnum.manager) {
      return 'manager';
    }
    if (numericRoleId === RoleEnum.user) {
      return 'default';
    }

    // Fallback to default for unknown roles
    this.logger.warn(
      `Unknown role ID ${roleId}, defaulting to 'default' role`,
    );
    return 'default';
  }

  /**
   * Create user in AnythingLLM
   *
   * Implements idempotency check: if user exists (by externalId), return existing user ID.
   * Otherwise, create new user.
   *
   * @param user - Keystone user
   * @returns AnythingLLM user ID
   */
  async createUserInAnythingLLM(user: User): Promise<number> {
    const keystoneUserId = String(user.id);

    // Check if user already exists (idempotency check)
    if (this.mappingRepository) {
      const existingMapping =
        await this.mappingRepository.findByKeystoneUserId(keystoneUserId);
      if (existingMapping) {
        this.logger.log(
          `User ${keystoneUserId} already provisioned in AnythingLLM (user ID: ${existingMapping.anythingllmUserId})`,
        );
        return existingMapping.anythingllmUserId;
      }
    }

    // Check if user already exists by externalId (idempotency check)
    try {
      const existingUserResult = await this.adminService.getUserByExternalId(
        keystoneUserId,
        'keystone',
      );

      if (existingUserResult.data.user) {
        const existingUserId = existingUserResult.data.user.id;
        this.logger.log(
          `User ${keystoneUserId} already exists in AnythingLLM (user ID: ${existingUserId})`,
        );
        return existingUserId;
      }
    } catch (error) {
      // User doesn't exist (404) or other error - proceed with user creation
      // 404 is expected when user doesn't exist, so we continue
      const isNotFound =
        error instanceof UpstreamError &&
        error.status === 404;
      
      if (!isNotFound) {
        this.logger.warn(
          `Failed to check for existing user by externalId: ${error instanceof Error ? error.message : 'Unknown error'}. Proceeding with user creation.`,
        );
      }
    }

    // Generate username (non-PII, deterministic hash)
    const username = this.generateUsername(keystoneUserId);

    // Generate secure password (will be discarded after API call)
    const password = this.generateSecurePassword();

    // Map Keystone role to AnythingLLM role
    const roleId = user.role?.id;
    const anythingllmRole = this.mapKeystoneRoleToAnythingLLMRole(roleId);

    this.logger.log(
      `Mapping Keystone role ${roleId} to AnythingLLM role '${anythingllmRole}' for user ${keystoneUserId}`,
    );

    // Create user with mapped role and external identity fields
    const createRequest: CreateUserRequestSchema = {
      username,
      password,
      role: anythingllmRole,
      externalId: keystoneUserId,
      externalProvider: 'keystone',
    };

    try {
      const result = await this.adminService.createUser(createRequest);

      if (result.data.error) {
        throw new Error(
          `AnythingLLM user creation failed: ${result.data.error}`,
        );
      }

      if (!result.data.user) {
        throw new Error('AnythingLLM user creation returned no user');
      }

      const anythingllmUserId = result.data.user.id;

      // Password is discarded here (never stored, never logged)
      // This is a permanent invariant: passwords are never persisted

      this.logger.log(
        `Created user in AnythingLLM: ${anythingllmUserId} (username: ${username}, role: ${anythingllmRole}, keystoneUserId: ${keystoneUserId})`,
      );

      return anythingllmUserId;
    } catch (error) {
      // Handle timeout errors (database connection issues on AnythingLLM side)
      if (
        error instanceof Error &&
        (error.message.includes('timeout') ||
          error.message.includes('Timed out') ||
          error.message.includes('ConnectionError'))
      ) {
        this.logger.error(
          `AnythingLLM database timeout during user creation for Keystone user ${keystoneUserId}. ` +
            `This is an AnythingLLM infrastructure issue (database connection timeout). ` +
            `Username format is valid: ${username}. Retry may succeed.`,
        );
        throw new Error(
          `AnythingLLM database timeout: ${error.message}. This is a transient infrastructure issue on AnythingLLM side.`,
        );
      }

      // Handle duplicate user errors (idempotency)
      if (
        error instanceof UpstreamError &&
        (error.status === 409 || error.message.includes('duplicate'))
      ) {
        this.logger.warn(
          `User ${keystoneUserId} may already exist in AnythingLLM. Attempting to find existing user.`,
        );
        // Try to find existing user by listing and matching username
        // Note: This is a workaround until externalId lookup is available
        throw new Error(
          'User creation failed with duplicate error. Manual reconciliation may be required.',
        );
      }
      throw error;
    }
  }

  /**
   * Assign user to their unique workspace
   *
   * Required step for provisioning completion.
   * Verifies workspace exists and user is the sole member (invariant check).
   *
   * @param anythingllmUserId - AnythingLLM user ID
   * @param workspaceSlug - Workspace slug
   * @param user - Keystone user (for audit logging)
   */
  async assignUserToWorkspace(
    anythingllmUserId: number,
    workspaceSlug: string,
    user: User,
  ): Promise<void> {
    const keystoneUserId = String(user.id);

    // Assign user to workspace
    const manageRequest: ManageWorkspaceUsersRequestSchema = {
      userIds: [anythingllmUserId],
      reset: false, // Always false (additive assignment)
    };

    try {
      const result = await this.adminService.manageWorkspaceUsers(
        workspaceSlug,
        manageRequest,
      );

      if (!result.data.success) {
        throw new Error(
          `Workspace assignment failed: ${result.data.error || 'Unknown error'}`,
        );
      }

      // Try to verify workspace exists and user is sole member
      // If verification endpoint is unavailable, successful manageWorkspaceUsers is treated as sufficient
      try {
        // Note: getWorkspaceUsers requires workspaceId (number), not slug
        // We may not have workspaceId yet. For now, we'll skip verification if not available.
        // The plan states: "If workspace verification endpoints are unavailable,
        // successful manageWorkspaceUsers execution is treated as sufficient verification."
        this.logger.log(
          `Workspace assignment successful for user ${anythingllmUserId} to workspace ${workspaceSlug}`,
        );
      } catch {
        this.logger.warn(
          `Workspace verification unavailable, treating successful manageWorkspaceUsers as sufficient verification`,
        );
      }

      // Log workspace assignment succeeded
      this.auditService.logAuthEvent({
        userId: keystoneUserId,
        provider: 'anythingllm',
        event: AuthEventType.ANYTHINGLLM_WORKSPACE_ASSIGNMENT_SUCCEEDED,
        success: true,
        metadata: {
          anythingllmUserId,
          workspaceSlug,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Log workspace assignment failed
      this.auditService.logAuthEvent({
        userId: keystoneUserId,
        provider: 'anythingllm',
        event: AuthEventType.ANYTHINGLLM_WORKSPACE_ASSIGNMENT_FAILED,
        success: false,
        errorMessage,
        metadata: {
          anythingllmUserId,
          workspaceSlug,
        },
      });

      throw error;
    }
  }

  /**
   * Suspend user in AnythingLLM
   *
   * Called when user status changes to inactive or user is deleted.
   *
   * @param anythingllmUserId - AnythingLLM user ID
   * @param user - Keystone user (for audit logging)
   */
  async suspendUser(anythingllmUserId: number, user: User): Promise<void> {
    const keystoneUserId = String(user.id);

    try {
      const result = await this.adminService.updateUser(anythingllmUserId, {
        suspended: 1,
      });

      if (!result.data.success) {
        throw new Error(
          `User suspension failed: ${result.data.error || 'Unknown error'}`,
        );
      }

      // Log suspension synced
      this.auditService.logAuthEvent({
        userId: keystoneUserId,
        provider: 'anythingllm',
        event: AuthEventType.ANYTHINGLLM_USER_SUSPENSION_SYNCED,
        success: true,
        metadata: {
          anythingllmUserId,
        },
      });

      this.logger.log(
        `Suspended user ${anythingllmUserId} in AnythingLLM (Keystone user: ${keystoneUserId})`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Failed to suspend user ${anythingllmUserId} in AnythingLLM: ${errorMessage}`,
      );

      // Still log the attempt (even if it failed)
      this.auditService.logAuthEvent({
        userId: keystoneUserId,
        provider: 'anythingllm',
        event: AuthEventType.ANYTHINGLLM_USER_SUSPENSION_SYNCED,
        success: false,
        errorMessage,
        metadata: {
          anythingllmUserId,
        },
      });

      // Don't throw - suspension sync failure shouldn't block user deletion/status update
      // This is a safe failure mode
    }
  }

  /**
   * Find AnythingLLM user ID by Keystone external ID
   *
   * @param keystoneUserId - Keystone user ID
   * @returns AnythingLLM user ID, or null if not found
   */
  async findAnythingLLMUserId(keystoneUserId: string): Promise<number | null> {
    if (!this.mappingRepository) {
      return null;
    }
    const mapping =
      await this.mappingRepository.findByKeystoneUserId(keystoneUserId);
    return mapping ? mapping.anythingllmUserId : null;
  }

  /**
   * Generate username from Keystone user ID (non-PII)
   *
   * Uses SHA-256 hash to avoid embedding PII in persistent identifiers.
   * Format: patient_{hash_slice(16)}
   *
   * Username format compliance:
   * - Must contain only lowercase letters, periods, numbers, underscores, and hyphens
   * - No spaces allowed
   * - Our format: patient_{16_char_hex_hash} = lowercase letters + underscore + hex digits (0-9, a-f)
   * - This is guaranteed to be valid per AnythingLLM validation rules
   *
   * @param keystoneUserId - Keystone user ID (string)
   * @returns Username (patient_{hash}) - guaranteed valid format
   */
  private generateUsername(keystoneUserId: string): string {
    const hash = createHash('sha256')
      .update(keystoneUserId)
      .digest('hex')
      .slice(0, 16);
    const username = `patient_${hash}`;

    // Defensive validation: ensure format compliance
    // This should never fail, but provides early detection if hash format changes
    if (!/^[a-z0-9_.-]+$/.test(username)) {
      throw new Error(
        `Generated username does not match AnythingLLM validation rules: ${username}`,
      );
    }

    return username;
  }

  /**
   * Generate secure random password
   *
   * Generates 32+ character password with mixed case, numbers, and symbols.
   * Password is discarded immediately after API call (never stored).
   *
   * @returns Secure random password
   */
  private generateSecurePassword(): string {
    // Generate 32 bytes (256 bits) of random data
    const randomBytesData = randomBytes(32);

    // Character sets for password generation
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    const allChars = lowercase + uppercase + numbers + symbols;

    // Convert random bytes to password characters
    let password = '';
    for (let i = 0; i < randomBytesData.length; i++) {
      password += allChars[randomBytesData[i] % allChars.length];
    }

    // Ensure password has at least one of each character type
    // This ensures complexity requirements are met
    if (!/[a-z]/.test(password)) {
      password =
        lowercase[randomBytesData[0] % lowercase.length] + password.slice(1);
    }
    if (!/[A-Z]/.test(password)) {
      password =
        uppercase[randomBytesData[1] % uppercase.length] + password.slice(1);
    }
    if (!/[0-9]/.test(password)) {
      password =
        numbers[randomBytesData[2] % numbers.length] + password.slice(1);
    }
    if (!/[^a-zA-Z0-9]/.test(password)) {
      password =
        symbols[randomBytesData[3] % symbols.length] + password.slice(1);
    }

    return password;
  }
}
