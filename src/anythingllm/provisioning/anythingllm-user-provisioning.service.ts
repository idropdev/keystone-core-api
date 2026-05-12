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
import { AnythingLLMUserThreadRepository } from './infrastructure/persistence/repositories/anythingllm-user-thread.repository';
import { AllConfigType } from '../../config/config.type';
import { RoleEnum } from '../../roles/roles.enum';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { AnythingLLMWorkspaceService } from '../workspace/anythingllm-workspace.service';
import {
  CreateWorkspaceRequestSchema,
  CreateWorkspaceResponseSchema,
} from '../registry/schemas/workspace.schema';
import { GetWorkspaceUsersResponseSchema } from '../registry/schemas/admin-workspace.schema';

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
  // System admin ID for service-initiated provisioning (when no admin context available)
  // This is the seeded admin user (ID: 1) used for system operations
  private readonly SYSTEM_ADMIN_ID = 1;

  constructor(
    private readonly adminService: AnythingLLMAdminService,
    private readonly orchestratorService: AnythingLLMOrchestratorService,
    private readonly auditService: AuditService,
    private readonly workspaceMapper: WorkspaceMapperService,
    private readonly workspaceService: AnythingLLMWorkspaceService,
    private readonly configService: ConfigService<AllConfigType>,
    @Optional()
    @Inject(AnythingLLMUserMappingRepository)
    private readonly mappingRepository?: AnythingLLMUserMappingRepository,
    @Optional()
    @Inject(AnythingLLMUserThreadRepository)
    private readonly threadRepository?: AnythingLLMUserThreadRepository,
  ) {}

  /**
   * Complete provisioning flow (user creation + workspace creation + assignment)
   *
   * Invariant: All three steps must succeed, or provisioning is incomplete.
   * Throws error if any step fails (for retry logic).
   *
   * @param user - Keystone user to provision
   * @param adminUserId - Optional admin user ID for delegated token context (required for HS256 tokens)
   */
  async provisionUser(
    user: User,
    adminUserId?: string | number,
  ): Promise<void> {
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
      const anythingllmUserId = await this.createUserInAnythingLLM(
        user,
        adminUserId,
      );

      // Step 2: Generate workspace slug (for mapping purposes)
      const workspaceSlug = this.workspaceMapper.getWorkspaceSlugForUser(user);

      // Step 3: Create workspace for user
      const { workspaceId, workspaceSlug: actualWorkspaceSlug } =
        await this.createWorkspaceForUser(
          workspaceSlug,
          keystoneUserId,
          adminUserId,
        );

      // Use the actual slug from AnythingLLM response (might differ from requested)
      // This is critical - AnythingLLM might sanitize/truncate the slug
      const effectiveWorkspaceSlug = actualWorkspaceSlug || workspaceSlug;

      // Step 4: Assign user to workspace (only for default users)
      // Admin and Manager roles have access to ALL workspaces automatically,
      // so workspace assignment is not necessary for them.
      if (anythingllmRole === 'default') {
        await this.assignUserToWorkspace(
          anythingllmUserId,
          effectiveWorkspaceSlug, // Use actual slug from response
          user,
          adminUserId,
        );

        // Step 5: Verify assignment
        await this.verifyWorkspaceAssignment(
          workspaceId,
          anythingllmUserId,
          adminUserId,
        );
      } else {
        // Admin and manager roles don't need workspace assignment (they have access to all)
        this.logger.log(
          `Skipping workspace assignment for ${anythingllmRole} user ${keystoneUserId} - ${anythingllmRole} users have access to all workspaces automatically`,
        );
      }

      // Step 6: Store mapping (use actual slug and ID from response)
      await this.mappingRepository.create({
        keystoneUserId,
        anythingllmUserId,
        workspaceId, // Store workspace ID for future reference
        workspaceSlug: effectiveWorkspaceSlug, // Use actual slug from response
      });

      // Log provisioning succeeded with role mapping details
      this.auditService.logAuthEvent({
        userId: keystoneUserId,
        provider: 'anythingllm',
        event: AuthEventType.ANYTHINGLLM_USER_PROVISIONING_SUCCEEDED,
        success: true,
        metadata: {
          anythingllmUserId,
          workspaceSlug: effectiveWorkspaceSlug, // Use actual slug from response
          workspaceId,
          keystoneRoleId: roleId,
          anythingllmRole,
        },
      });

      this.logger.log(
        `Successfully provisioned user ${keystoneUserId} to AnythingLLM (user ID: ${anythingllmUserId}, workspace: ${effectiveWorkspaceSlug}, workspace ID: ${workspaceId})`,
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
  private mapKeystoneRoleToAnythingLLMRole(
    roleId: number | string | null | undefined,
  ): string {
    if (roleId === null || roleId === undefined) {
      return 'default';
    }

    // Handle both numeric and string role IDs
    const numericRoleId =
      typeof roleId === 'string' ? parseInt(roleId, 10) : roleId;

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
    this.logger.warn(`Unknown role ID ${roleId}, defaulting to 'default' role`);
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
  async createUserInAnythingLLM(
    user: User,
    adminUserId?: string | number,
  ): Promise<number> {
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
    // Use orchestrator with delegated tokens (HS256) - matches document upload pattern
    try {
      // Always use delegated tokens (HS256) with admin context
      // If no admin context provided, use system admin ID
      const effectiveAdminId = adminUserId || this.SYSTEM_ADMIN_ID;

      const requesterContext: RequesterContextDto = {
        userId: String(effectiveAdminId),
        roles: ['admin'],
      };

      const response = await this.orchestratorService.executeOperation({
        requesterContext,
        operation: AnythingLLMOperation.SYSTEM_READ,
        endpoint: `/v1/admin/users/external/${keystoneUserId}?provider=keystone`,
        method: 'GET',
      });

      if (!response.ok) {
        // User doesn't exist (404) - this is expected for new users
        if (response.status === 404) {
          // Continue with user creation
        } else {
          // Other error - convert to UpstreamError
          throw await UpstreamError.fromResponse(
            response,
            response.headers.get('X-Request-Id') || 'unknown',
            `/v1/admin/users/external/${keystoneUserId}?provider=keystone`,
            null,
          );
        }
      } else {
        // User exists - return existing ID
        const data = await response.json();
        const existingUserResult = { data };

        if (existingUserResult.data.user) {
          const existingUserId = existingUserResult.data.user.id;
          this.logger.log(
            `User ${keystoneUserId} already exists in AnythingLLM (user ID: ${existingUserId})`,
          );
          return existingUserId;
        }
      }
    } catch (error) {
      // User doesn't exist (404) or other error - proceed with user creation
      // 404 is expected when user doesn't exist, so we continue
      const isNotFound = error instanceof UpstreamError && error.status === 404;

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
      // Always use delegated tokens (HS256) with admin context
      // If no admin context provided, use system admin ID
      // This matches the pattern used in document upload (orchestrator issues delegated tokens)
      const effectiveAdminId = adminUserId || this.SYSTEM_ADMIN_ID;

      const requesterContext: RequesterContextDto = {
        userId: String(effectiveAdminId),
        roles: ['admin'],
      };

      const response = await this.orchestratorService.executeOperation({
        requesterContext,
        operation: AnythingLLMOperation.SYSTEM_READ,
        endpoint: '/v1/admin/users/new',
        method: 'POST',
        body: createRequest,
      });

      if (!response.ok) {
        // Convert HTTP error to UpstreamError for consistent error handling
        throw await UpstreamError.fromResponse(
          response,
          response.headers.get('X-Request-Id') || 'unknown',
          '/v1/admin/users/new',
          createRequest,
        );
      }

      const data = await response.json();
      const result = { data };

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
   * Create workspace for user with default configuration
   *
   * Creates a workspace with the specified slug and default settings.
   * Uses admin delegated token context for authorization.
   *
   * @param workspaceSlug - Workspace slug (generated from user ID)
   * @param keystoneUserId - Keystone user ID (for logging)
   * @param adminUserId - Optional admin user ID for delegated token context
   * @returns Workspace ID
   */
  async createWorkspaceForUser(
    workspaceSlug: string,
    keystoneUserId: string,
    adminUserId?: string | number,
  ): Promise<{ workspaceId: number; workspaceSlug: string }> {
    // Log workspace creation started
    this.auditService.logAuthEvent({
      userId: keystoneUserId,
      provider: 'anythingllm',
      event: AuthEventType.ANYTHINGLLM_WORKSPACE_CREATION_STARTED,
      success: true,
      metadata: {
        workspaceSlug,
      },
    });

    // Retry configuration for workspace creation
    // Retry on transient errors (5xx) up to 3 times with exponential backoff
    const maxRetries = 3;
    const retryDelayMs = 1000; // Initial delay: 1 second
    const retryableStatusCodes = [500, 502, 503, 504]; // Transient server errors

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Always use delegated tokens (HS256) with admin context
        // If no admin context provided, use system admin ID
        // This matches the pattern used in document upload (orchestrator issues delegated tokens)
        const effectiveAdminId = adminUserId || this.SYSTEM_ADMIN_ID;

        const requesterContext: RequesterContextDto = {
          userId: String(effectiveAdminId),
          roles: ['admin'],
        };

        // Default workspace configuration matching user's example payload
        const workspaceRequest: CreateWorkspaceRequestSchema = {
          name: `Workspace for user ${keystoneUserId}`,
          slug: workspaceSlug,
          chatMode: 'chat',
          topN: 8,
          similarityThreshold: 0.68,
          openAiTemp: 0.2,
          openAiHistory: 12,
          openAiPrompt:
            '## ROLE\nYou are a precise, citation-first assistant.\n\n## GOAL\nAnswer clearly and thoroughly using ONLY the retrieved context when it\'s relevant. If key context is missing or insufficient, say so explicitly before you infer anything.\n\n## OUTPUT RULES\n- Start with a 1–2 sentence direct answer.\n- Then give a short, structured explanation.\n- Cite each non-trivial claim with the specific source IDs.\n- If context is weak: say "Insufficient context" and ask for one targeted follow-up question.\n- Never fabricate citations or data.\n',
          queryRefusalResponse:
            "I don't have enough grounded context to answer confidently. Please add more detail or documents I can search",
        };

        // Pass requesterContext - this will use orchestrator which issues delegated tokens (HS256)
        const response = await this.workspaceService.createWorkspace(
          workspaceRequest,
          requesterContext,
        );

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(
            `Failed to create workspace: ${response.status} - ${errorText}`,
          ) as Error & { statusCode?: number };
          error.statusCode = response.status;

          // Check if error is retryable (transient server error)
          const isRetryable =
            retryableStatusCodes.includes(response.status) &&
            attempt < maxRetries;

          if (isRetryable) {
            // Calculate exponential backoff delay: 1s, 2s, 4s
            const delay = retryDelayMs * Math.pow(2, attempt - 1);
            this.logger.warn(
              `Workspace creation failed with ${response.status} (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms...`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            lastError = error;
            continue; // Retry
          }

          // Non-retryable error or max retries reached
          throw error;
        }

        const result = (await response.json()) as CreateWorkspaceResponseSchema;

        if (!result.workspace) {
          const error = new Error(
            `Failed to create workspace: ${result.message || 'Unknown error'}`,
          );
          // Treat missing workspace as non-retryable (likely validation error)
          throw error;
        }

        const workspaceId = result.workspace.id;
        // CRITICAL: Use the slug from the response, not the one we passed in
        // AnythingLLM might sanitize, truncate, or auto-generate the slug
        const actualWorkspaceSlug = result.workspace.slug || workspaceSlug;

        // Small delay to ensure workspace is indexed/available in AnythingLLM
        // This handles potential race conditions where workspace creation completes
        // but the workspace isn't immediately available for user assignment
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay

        // Log workspace creation succeeded
        this.auditService.logAuthEvent({
          userId: keystoneUserId,
          provider: 'anythingllm',
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_CREATION_SUCCEEDED,
          success: true,
          metadata: {
            workspaceId,
            workspaceSlug: actualWorkspaceSlug,
            requestedSlug: workspaceSlug, // Log what we requested vs what we got
            attempts: attempt, // Log number of attempts if retried
          },
        });

        if (attempt > 1) {
          this.logger.log(
            `Created workspace ${actualWorkspaceSlug} (ID: ${workspaceId}) for user ${keystoneUserId} after ${attempt} attempts (requested: ${workspaceSlug})`,
          );
        } else {
          this.logger.log(
            `Created workspace ${actualWorkspaceSlug} (ID: ${workspaceId}) for user ${keystoneUserId} (requested: ${workspaceSlug})`,
          );
        }

        // Return both ID and actual slug (from response, not request)
        return { workspaceId, workspaceSlug: actualWorkspaceSlug };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a retryable error
        const statusCode = (error as any).statusCode;
        const isRetryable =
          statusCode &&
          retryableStatusCodes.includes(statusCode) &&
          attempt < maxRetries;

        if (isRetryable) {
          // Calculate exponential backoff delay: 1s, 2s, 4s
          const delay = retryDelayMs * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Workspace creation failed (attempt ${attempt}/${maxRetries}): ${errorMessage}. Retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue; // Retry
        }

        // Non-retryable error or max retries reached - log and throw
        this.auditService.logAuthEvent({
          userId: keystoneUserId,
          provider: 'anythingllm',
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_CREATION_FAILED,
          success: false,
          errorMessage,
          metadata: {
            workspaceSlug,
            attempts: attempt,
            finalAttempt: attempt === maxRetries,
          },
        });

        this.logger.error(
          `Failed to create workspace ${workspaceSlug} for user ${keystoneUserId} after ${attempt} attempt(s): ${errorMessage}`,
        );

        throw lastError;
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError || new Error('Failed to create workspace: unknown error');
  }

  /**
   * Assign user to their unique workspace
   *
   * Required step for provisioning completion.
   * Uses admin delegated token context for authorization.
   *
   * @param anythingllmUserId - AnythingLLM user ID
   * @param workspaceSlug - Workspace slug
   * @param user - Keystone user (for audit logging)
   * @param adminUserId - Optional admin user ID for delegated token context
   */
  async assignUserToWorkspace(
    anythingllmUserId: number,
    workspaceSlug: string,
    user: User,
    adminUserId?: string | number,
  ): Promise<void> {
    const keystoneUserId = String(user.id);

    // Assign user to workspace
    const manageRequest: ManageWorkspaceUsersRequestSchema = {
      userIds: [anythingllmUserId],
      reset: false, // Always false (additive assignment)
    };

    try {
      // Always use delegated tokens (HS256) with admin context
      // If no admin context provided, use system admin ID
      // This matches the pattern used in document upload (orchestrator issues delegated tokens)
      const effectiveAdminId = adminUserId || this.SYSTEM_ADMIN_ID;

      const requesterContext: RequesterContextDto = {
        userId: String(effectiveAdminId),
        roles: ['admin'],
      };

      // Use orchestrator service directly with delegated tokens (bypass controller)
      const response = await this.orchestratorService.executeOperation({
        requesterContext,
        operation: AnythingLLMOperation.SYSTEM_READ,
        endpoint: `/v1/admin/workspaces/${workspaceSlug}/manage-users`,
        method: 'POST',
        body: manageRequest,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Workspace assignment failed: ${response.status} - ${errorText}`,
        );
      }

      const result = (await response.json()) as {
        success: boolean;
        error?: string | null;
        users?: Array<{
          userId: number;
          username?: string;
          role: string;
        }>;
      };

      if (!result.success) {
        throw new Error(
          `Workspace assignment failed: ${result.error || 'Unknown error'}`,
        );
      }

      this.logger.log(
        `Workspace assignment successful for user ${anythingllmUserId} to workspace ${workspaceSlug}`,
      );

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
   * Verify user is assigned to workspace
   *
   * Calls the admin endpoint to verify the user is in the workspace's user list.
   * Uses admin delegated token context for authorization.
   * Gracefully degrades if verification endpoint is unavailable.
   *
   * @param workspaceId - Workspace ID (number)
   * @param anythingllmUserId - AnythingLLM user ID to verify
   * @param adminUserId - Optional admin user ID for delegated token context
   */
  async verifyWorkspaceAssignment(
    workspaceId: number,
    anythingllmUserId: number,
    adminUserId?: string | number,
  ): Promise<void> {
    try {
      // Always use delegated tokens (HS256) with admin context
      // If no admin context provided, use system admin ID
      // This matches the pattern used in document upload (orchestrator issues delegated tokens)
      const effectiveAdminId = adminUserId || this.SYSTEM_ADMIN_ID;

      const requesterContext: RequesterContextDto = {
        userId: String(effectiveAdminId),
        roles: ['admin'],
      };

      // Use orchestrator service directly with delegated tokens (bypass controller)
      const response = await this.orchestratorService.executeOperation({
        requesterContext,
        operation: AnythingLLMOperation.SYSTEM_READ,
        endpoint: `/v1/admin/workspaces/${workspaceId}/users`,
        method: 'GET',
      });

      if (!response.ok) {
        // If verification endpoint is unavailable, log warning but don't fail
        this.logger.warn(
          `Workspace verification unavailable for workspace ${workspaceId}: ${response.status}. Treating successful assignment as sufficient verification.`,
        );
        return;
      }

      const result = (await response.json()) as GetWorkspaceUsersResponseSchema;

      // Verify user ID is in the list
      const userFound = result.users?.some(
        (user) => user.userId === anythingllmUserId,
      );

      if (userFound) {
        this.logger.log(
          `Verified user ${anythingllmUserId} is assigned to workspace ${workspaceId}`,
        );

        // Log verification succeeded
        this.auditService.logAuthEvent({
          userId: String(anythingllmUserId),
          provider: 'anythingllm',
          event: AuthEventType.ANYTHINGLLM_WORKSPACE_ASSIGNMENT_VERIFIED,
          success: true,
          metadata: {
            workspaceId,
            anythingllmUserId,
          },
        });
      } else {
        this.logger.warn(
          `User ${anythingllmUserId} not found in workspace ${workspaceId} user list. Assignment may have failed.`,
        );
        // Don't throw - verification failure shouldn't fail provisioning
        // This is a warning only
      }
    } catch (error) {
      // Graceful degradation: if verification fails, log warning but don't fail provisioning
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Workspace verification failed for workspace ${workspaceId}: ${errorMessage}. Treating successful assignment as sufficient verification.`,
      );
      // Don't throw - verification is optional
    }
  }

  /**
   * Suspend user in AnythingLLM
   *
   * Called when user status changes to inactive or user is deleted.
   * ALWAYS uses delegated tokens (HS256) via orchestrator - NEVER service identity (RS256).
   *
   * @param anythingllmUserId - AnythingLLM user ID
   * @param user - Keystone user (for audit logging)
   * @param adminUserId - Optional admin user ID for delegated token context
   */
  async suspendUser(
    anythingllmUserId: number,
    user: User,
    adminUserId?: string | number,
  ): Promise<void> {
    const keystoneUserId = String(user.id);

    try {
      // Always use delegated tokens (HS256) with admin context via orchestrator
      // If no admin context provided, use system admin ID
      const effectiveAdminId = adminUserId || this.SYSTEM_ADMIN_ID;

      const requesterContext: RequesterContextDto = {
        userId: String(effectiveAdminId),
        roles: ['admin'],
      };

      // Use orchestrator service directly with delegated tokens (HS256)
      // Note: Using SYSTEM_READ for admin operations (same as user creation)
      // Admin operations use SYSTEM_READ since they're system-level admin actions
      const response = await this.orchestratorService.executeOperation({
        requesterContext,
        operation: AnythingLLMOperation.SYSTEM_READ,
        endpoint: `/v1/admin/users/${anythingllmUserId}`,
        method: 'POST',
        body: {
          suspended: 1,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `User suspension failed: ${response.status} - ${body || 'Unknown error'}`,
        );
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(
          `User suspension failed: ${result.error || 'Unknown error'}`,
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

  /**
   * Get AnythingLLM workspace mapping for a Keystone user (INTERNAL USE ONLY)
   *
   * This method is for internal system use only (tests, background jobs, internal services).
   * DO NOT expose this as a REST endpoint - it could leak sensitive system architecture.
   *
   * Security Considerations:
   * - Reveals which users have AnythingLLM accounts
   * - Exposes workspace slug patterns
   * - Could be used for enumeration attacks if exposed publicly
   *
   * @param keystoneUserId - Keystone user ID (string or number)
   * @returns Workspace mapping or null if not found
   * @internal
   */
  async getWorkspaceMappingForUser(keystoneUserId: string | number): Promise<{
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceId: number | null;
    workspaceSlug: string;
    createdAt?: Date;
    updatedAt?: Date;
  } | null> {
    if (!this.mappingRepository) {
      this.logger.warn(
        'Mapping repository not available - workspace mapping cannot be retrieved',
      );
      return null;
    }

    const mapping = await this.mappingRepository.findByKeystoneUserId(
      String(keystoneUserId),
    );

    if (!mapping) {
      return null;
    }

    return {
      keystoneUserId: mapping.keystoneUserId,
      anythingllmUserId: mapping.anythingllmUserId,
      workspaceId: mapping.workspaceId,
      workspaceSlug: mapping.workspaceSlug,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    };
  }

  /**
   * Soft-delete a thread row from the local `anythingllm_user_threads` mirror.
   * Safe to call even if the row is missing. Used after upstream AnythingLLM
   * thread deletion succeeds, to keep the local mirror in sync.
   */
  async softDeleteThread(threadSlug: string): Promise<void> {
    if (!this.threadRepository) {
      this.logger.warn(
        'Thread repository not available - local mirror soft-delete skipped',
      );
      return;
    }
    await this.threadRepository.softDelete(threadSlug);
  }

  /**
   * Record a thread created by a user (internal use only)
   *
   * Stores thread information in the database for tracking and audit purposes.
   * This method should be called whenever a new thread is created in AnythingLLM.
   *
   * @param data - Thread creation data
   * @internal
   */
  async recordUserThread(data: {
    keystoneUserId: string | number;
    workspaceSlug: string;
    threadSlug: string;
    threadName?: string;
  }): Promise<void> {
    if (!this.threadRepository || !this.mappingRepository) {
      this.logger.warn(
        'Thread repository not available - thread cannot be recorded',
      );
      return;
    }

    try {
      // Get the user mapping to get anythingllmUserId and workspaceId
      const mapping = await this.mappingRepository.findByKeystoneUserId(
        String(data.keystoneUserId),
      );

      if (!mapping) {
        this.logger.warn(
          `Cannot record thread - no mapping found for user ${data.keystoneUserId}`,
        );
        return;
      }

      // Record the thread
      await this.threadRepository.create({
        keystoneUserId: String(data.keystoneUserId),
        anythingllmUserId: mapping.anythingllmUserId,
        workspaceSlug: data.workspaceSlug,
        threadSlug: data.threadSlug,
        threadName: data.threadName,
        workspaceId: mapping.workspaceId || undefined,
      });

      this.logger.log(
        `Recorded thread ${data.threadSlug} for user ${data.keystoneUserId} in workspace ${data.workspaceSlug}`,
      );
    } catch (error) {
      // Don't fail the thread creation if recording fails
      this.logger.error(
        `Failed to record thread ${data.threadSlug} for user ${data.keystoneUserId}:`,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  /**
   * Get all threads for a user (internal use only)
   *
   * Returns all threads created by a Keystone user across all workspaces.
   *
   * @param keystoneUserId - Keystone user ID (string or number)
   * @returns Array of thread records
   * @internal
   */
  async getUserThreads(keystoneUserId: string | number): Promise<
    Array<{
      threadSlug: string;
      threadName: string | null;
      workspaceSlug: string;
      workspaceId: number | null;
      messageCount: number;
      lastMessageAt: Date | null;
      createdAt: Date;
    }>
  > {
    if (!this.threadRepository) {
      this.logger.warn(
        'Thread repository not available - cannot retrieve threads',
      );
      return [];
    }

    const threads = await this.threadRepository.findByKeystoneUserId(
      String(keystoneUserId),
    );

    return threads.map((thread) => ({
      threadSlug: thread.threadSlug,
      threadName: thread.threadName,
      workspaceSlug: thread.workspaceSlug,
      workspaceId: thread.workspaceId,
      messageCount: thread.messageCount,
      lastMessageAt: thread.lastMessageAt,
      createdAt: thread.createdAt,
    }));
  }
}
