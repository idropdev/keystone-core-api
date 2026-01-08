import { Injectable, Logger } from '@nestjs/common';
import {
  AnythingLLMRegistryClient,
  RegistryCallResult,
} from '../registry/anythingllm-registry-client';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';
import {
  IsMultiUserModeResponseSchema,
  ListUsersResponseSchema,
  CreateUserRequestSchema,
  CreateUserResponseSchema,
  UpdateUserRequestSchema,
  UserOperationResponseSchema,
  ListInvitesResponseSchema,
  CreateInviteRequestSchema,
  CreateInviteResponseSchema,
  InviteOperationResponseSchema,
  GetWorkspaceUsersResponseSchema,
  ManageWorkspaceUsersRequestSchema,
  ManageWorkspaceUsersResponseSchema,
  WorkspaceChatsRequestSchema,
  WorkspaceChatsResponseSchema,
  UpdatePreferencesRequestSchema,
  UpdatePreferencesResponseSchema,
} from '../registry/schemas';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { UpstreamError } from '../registry/upstream-error';

/**
 * AnythingLLM Admin Service
 *
 * Provides typed methods for all AnythingLLM admin operations.
 * CRITICAL: All operations MUST use delegated tokens (HS256) via orchestrator.
 * NEVER use service identity (RS256) tokens.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMAdminService {
  private readonly logger = new Logger(AnythingLLMAdminService.name);
  // System admin ID for service-initiated operations (when no user context available)
  private readonly SYSTEM_ADMIN_ID = 1;

  constructor(
    private readonly registryClient: AnythingLLMRegistryClient,
    private readonly orchestratorService: AnythingLLMOrchestratorService,
  ) {}

  // ============================================================
  // System Status
  // ============================================================

  /**
   * Check if AnythingLLM instance is in multi-user mode
   */
  async isMultiUserMode(): Promise<
    RegistryCallResult<IsMultiUserModeResponseSchema>
  > {
    return this.registryClient.call<IsMultiUserModeResponseSchema>(
      AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE,
    );
  }

  // ============================================================
  // User Management
  // ============================================================

  /**
   * List all users in AnythingLLM
   */
  async listUsers(): Promise<RegistryCallResult<ListUsersResponseSchema>> {
    return this.registryClient.call<ListUsersResponseSchema>(
      AnythingLLMAdminEndpointIds.LIST_USERS,
    );
  }

  /**
   * Get user by external ID and provider
   *
   * CRITICAL: Uses delegated tokens (HS256) via orchestrator - NEVER service identity (RS256).
   * If no requesterContext provided, uses system admin (ID: 1) for delegated token context.
   *
   * @param externalId - External user ID (e.g., Keystone UUID)
   * @param provider - External provider (default: keystone)
   * @param requesterContext - Optional requester context for delegated token (falls back to system admin)
   * @returns User response from AnythingLLM
   */
  async getUserByExternalId(
    externalId: string,
    provider: string = 'keystone',
    requesterContext?: RequesterContextDto,
  ): Promise<RegistryCallResult<CreateUserResponseSchema>> {
    // Always use delegated tokens (HS256) with admin context via orchestrator
    // If no requesterContext provided, use system admin ID
    const effectiveRequesterContext: RequesterContextDto = requesterContext || {
      userId: String(this.SYSTEM_ADMIN_ID),
      roles: ['admin'],
    };

    const endpoint = `/v1/admin/users/external/${externalId}${provider ? `?provider=${provider}` : ''}`;

    try {
      const response = await this.orchestratorService.executeOperation({
        requesterContext: effectiveRequesterContext,
        operation: AnythingLLMOperation.SYSTEM_READ,
        endpoint,
        method: 'GET',
      });

      if (!response.ok) {
        // Extract request ID from response headers
        const requestId = response.headers.get('X-Request-Id') || 'unknown';
        
        // Parse error body
        const body = await response.text();
        throw await UpstreamError.fromResponse(
          response,
          requestId,
          endpoint,
          null,
        );
      }

      // Parse response
      const data = (await response.json()) as CreateUserResponseSchema;

      // Extract request ID for return value
      const requestId = response.headers.get('X-Request-Id') || 'unknown';

      return {
        data,
        requestId,
        status: response.status,
      };
    } catch (error) {
      // Re-throw UpstreamError as-is
      if (error instanceof UpstreamError) {
        throw error;
      }

      // Wrap other errors as UpstreamError
      const upstreamError = UpstreamError.fromNetworkError(
        error instanceof Error ? error : new Error(String(error)),
        'unknown',
        endpoint,
        null,
      );

      this.logger.error(
        `Failed to get user by external ID ${externalId} (provider: ${provider}): ${upstreamError.message}`,
      );

      throw upstreamError;
    }
  }

  /**
   * Create a new user in AnythingLLM
   */
  async createUser(
    request: CreateUserRequestSchema,
  ): Promise<RegistryCallResult<CreateUserResponseSchema>> {
    return this.registryClient.call<
      CreateUserResponseSchema,
      CreateUserRequestSchema
    >(AnythingLLMAdminEndpointIds.CREATE_USER, { body: request });
  }

  /**
   * Update an existing user
   */
  async updateUser(
    userId: number,
    request: UpdateUserRequestSchema,
  ): Promise<RegistryCallResult<UserOperationResponseSchema>> {
    return this.registryClient.call<
      UserOperationResponseSchema,
      UpdateUserRequestSchema
    >(AnythingLLMAdminEndpointIds.UPDATE_USER, {
      params: { id: userId },
      body: request,
    });
  }

  /**
   * Delete a user by ID
   */
  async deleteUser(
    userId: number,
  ): Promise<RegistryCallResult<UserOperationResponseSchema>> {
    return this.registryClient.call<UserOperationResponseSchema>(
      AnythingLLMAdminEndpointIds.DELETE_USER,
      { params: { id: userId } },
    );
  }

  // ============================================================
  // Invitation Management
  // ============================================================

  /**
   * List all invitations
   */
  async listInvites(): Promise<RegistryCallResult<ListInvitesResponseSchema>> {
    return this.registryClient.call<ListInvitesResponseSchema>(
      AnythingLLMAdminEndpointIds.LIST_INVITES,
    );
  }

  /**
   * Create a new invitation
   */
  async createInvite(
    request: CreateInviteRequestSchema,
  ): Promise<RegistryCallResult<CreateInviteResponseSchema>> {
    return this.registryClient.call<
      CreateInviteResponseSchema,
      CreateInviteRequestSchema
    >(AnythingLLMAdminEndpointIds.CREATE_INVITE, { body: request });
  }

  /**
   * Revoke an invitation by ID
   */
  async revokeInvite(
    inviteId: number,
  ): Promise<RegistryCallResult<InviteOperationResponseSchema>> {
    return this.registryClient.call<InviteOperationResponseSchema>(
      AnythingLLMAdminEndpointIds.REVOKE_INVITE,
      { params: { id: inviteId } },
    );
  }

  // ============================================================
  // Workspace Management
  // ============================================================

  /**
   * Get users with access to a workspace
   */
  async getWorkspaceUsers(
    workspaceId: number,
  ): Promise<RegistryCallResult<GetWorkspaceUsersResponseSchema>> {
    return this.registryClient.call<GetWorkspaceUsersResponseSchema>(
      AnythingLLMAdminEndpointIds.GET_WORKSPACE_USERS,
      { params: { workspaceId } },
    );
  }

  /**
   * Manage users in a workspace by slug
   */
  async manageWorkspaceUsers(
    workspaceSlug: string,
    request: ManageWorkspaceUsersRequestSchema,
  ): Promise<RegistryCallResult<ManageWorkspaceUsersResponseSchema>> {
    return this.registryClient.call<
      ManageWorkspaceUsersResponseSchema,
      ManageWorkspaceUsersRequestSchema
    >(AnythingLLMAdminEndpointIds.MANAGE_WORKSPACE_USERS, {
      params: { workspaceSlug },
      body: request,
    });
  }

  /**
   * Get workspace chats with pagination
   */
  async getWorkspaceChats(
    request: WorkspaceChatsRequestSchema,
  ): Promise<RegistryCallResult<WorkspaceChatsResponseSchema>> {
    return this.registryClient.call<
      WorkspaceChatsResponseSchema,
      WorkspaceChatsRequestSchema
    >(AnythingLLMAdminEndpointIds.WORKSPACE_CHATS, { body: request });
  }

  // ============================================================
  // System Preferences
  // ============================================================

  /**
   * Update system preferences
   */
  async updatePreferences(
    request: UpdatePreferencesRequestSchema,
  ): Promise<RegistryCallResult<UpdatePreferencesResponseSchema>> {
    return this.registryClient.call<
      UpdatePreferencesResponseSchema,
      UpdatePreferencesRequestSchema
    >(AnythingLLMAdminEndpointIds.UPDATE_PREFERENCES, { body: request });
  }
}
