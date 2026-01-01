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

/**
 * AnythingLLM Admin Service
 *
 * Provides typed methods for all AnythingLLM admin operations.
 * Uses the registry client for consistent request handling and error normalization.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMAdminService {
  private readonly logger = new Logger(AnythingLLMAdminService.name);

  constructor(private readonly registryClient: AnythingLLMRegistryClient) {}

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
