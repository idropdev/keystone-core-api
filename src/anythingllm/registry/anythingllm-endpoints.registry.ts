import { Type } from '@nestjs/common';
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
} from './schemas';

/**
 * HTTP methods supported by AnythingLLM endpoints
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Authentication policy for endpoints
 */
export type AuthPolicy = 'serviceIdentity' | 'userJwt' | 'none';

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  retryOn: number[]; // HTTP status codes to retry on
}

/**
 * Endpoint definition shape
 */
export interface EndpointDefinition<TRequest = unknown, TResponse = unknown> {
  /** Unique identifier for the endpoint */
  id: string;
  /** HTTP method */
  method: HttpMethod;
  /** URL path template with :param placeholders */
  path: string;
  /** Authentication policy */
  auth: AuthPolicy;
  /** Request body schema (class-validator DTO or null for no body) */
  requestSchema: Type<TRequest> | null;
  /** Response schema (class-validator DTO) */
  responseSchema: Type<TResponse>;
  /** Request timeout in milliseconds (optional) */
  timeoutMs?: number;
  /** Retry policy (optional) */
  retryPolicy?: RetryPolicy;
  /** Categorization tags */
  tags: string[];
  /** Whether endpoint is deprecated */
  deprecated?: boolean;
  /** Deprecation message if deprecated */
  deprecationMessage?: string;
}

/**
 * AnythingLLM Admin Endpoint IDs
 */
export const AnythingLLMAdminEndpointIds = {
  IS_MULTI_USER_MODE: 'admin.isMultiUserMode',
  LIST_USERS: 'admin.listUsers',
  CREATE_USER: 'admin.createUser',
  UPDATE_USER: 'admin.updateUser',
  DELETE_USER: 'admin.deleteUser',
  LIST_INVITES: 'admin.listInvites',
  CREATE_INVITE: 'admin.createInvite',
  REVOKE_INVITE: 'admin.revokeInvite',
  GET_WORKSPACE_USERS: 'admin.getWorkspaceUsers',
  MANAGE_WORKSPACE_USERS: 'admin.manageWorkspaceUsers',
  WORKSPACE_CHATS: 'admin.workspaceChats',
  UPDATE_PREFERENCES: 'admin.updatePreferences',
} as const;

export type AnythingLLMAdminEndpointId =
  (typeof AnythingLLMAdminEndpointIds)[keyof typeof AnythingLLMAdminEndpointIds];

/**
 * AnythingLLM Admin Endpoints Registry
 *
 * Single source of truth for all AnythingLLM admin API endpoints.
 * Each endpoint definition includes method, path, auth policy, schemas, and metadata.
 */
export const AnythingLLMAdminEndpoints: Record<
  AnythingLLMAdminEndpointId,
  EndpointDefinition
> = {
  // ============================================================
  // System Status
  // ============================================================
  [AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE]: {
    id: AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE,
    method: 'GET',
    path: '/v1/admin/is-multi-user-mode',
    auth: 'serviceIdentity',
    requestSchema: null,
    responseSchema: IsMultiUserModeResponseSchema,
    tags: ['admin', 'system'],
    timeoutMs: 5000,
  },

  // ============================================================
  // User Management
  // ============================================================
  [AnythingLLMAdminEndpointIds.LIST_USERS]: {
    id: AnythingLLMAdminEndpointIds.LIST_USERS,
    method: 'GET',
    path: '/v1/admin/users',
    auth: 'serviceIdentity',
    requestSchema: null,
    responseSchema: ListUsersResponseSchema,
    tags: ['admin', 'users'],
    timeoutMs: 10000,
  },

  [AnythingLLMAdminEndpointIds.CREATE_USER]: {
    id: AnythingLLMAdminEndpointIds.CREATE_USER,
    method: 'POST',
    path: '/v1/admin/users/new',
    auth: 'serviceIdentity',
    requestSchema: CreateUserRequestSchema,
    responseSchema: CreateUserResponseSchema,
    tags: ['admin', 'users'],
    timeoutMs: 10000,
  },

  [AnythingLLMAdminEndpointIds.UPDATE_USER]: {
    id: AnythingLLMAdminEndpointIds.UPDATE_USER,
    method: 'POST',
    path: '/v1/admin/users/:id',
    auth: 'serviceIdentity',
    requestSchema: UpdateUserRequestSchema,
    responseSchema: UserOperationResponseSchema,
    tags: ['admin', 'users'],
    timeoutMs: 10000,
  },

  [AnythingLLMAdminEndpointIds.DELETE_USER]: {
    id: AnythingLLMAdminEndpointIds.DELETE_USER,
    method: 'DELETE',
    path: '/v1/admin/users/:id',
    auth: 'serviceIdentity',
    requestSchema: null,
    responseSchema: UserOperationResponseSchema,
    tags: ['admin', 'users'],
    timeoutMs: 10000,
  },

  // ============================================================
  // Invitation Management
  // ============================================================
  [AnythingLLMAdminEndpointIds.LIST_INVITES]: {
    id: AnythingLLMAdminEndpointIds.LIST_INVITES,
    method: 'GET',
    path: '/v1/admin/invites',
    auth: 'serviceIdentity',
    requestSchema: null,
    responseSchema: ListInvitesResponseSchema,
    tags: ['admin', 'invites'],
    timeoutMs: 10000,
  },

  [AnythingLLMAdminEndpointIds.CREATE_INVITE]: {
    id: AnythingLLMAdminEndpointIds.CREATE_INVITE,
    method: 'POST',
    path: '/v1/admin/invite/new',
    auth: 'serviceIdentity',
    requestSchema: CreateInviteRequestSchema,
    responseSchema: CreateInviteResponseSchema,
    tags: ['admin', 'invites'],
    timeoutMs: 10000,
  },

  [AnythingLLMAdminEndpointIds.REVOKE_INVITE]: {
    id: AnythingLLMAdminEndpointIds.REVOKE_INVITE,
    method: 'DELETE',
    path: '/v1/admin/invite/:id',
    auth: 'serviceIdentity',
    requestSchema: null,
    responseSchema: InviteOperationResponseSchema,
    tags: ['admin', 'invites'],
    timeoutMs: 10000,
  },

  // ============================================================
  // Workspace Management
  // ============================================================
  [AnythingLLMAdminEndpointIds.GET_WORKSPACE_USERS]: {
    id: AnythingLLMAdminEndpointIds.GET_WORKSPACE_USERS,
    method: 'GET',
    path: '/v1/admin/workspaces/:workspaceId/users',
    auth: 'serviceIdentity',
    requestSchema: null,
    responseSchema: GetWorkspaceUsersResponseSchema,
    tags: ['admin', 'workspaces'],
    timeoutMs: 10000,
  },

  [AnythingLLMAdminEndpointIds.MANAGE_WORKSPACE_USERS]: {
    id: AnythingLLMAdminEndpointIds.MANAGE_WORKSPACE_USERS,
    method: 'POST',
    path: '/v1/admin/workspaces/:workspaceSlug/manage-users',
    auth: 'serviceIdentity',
    requestSchema: ManageWorkspaceUsersRequestSchema,
    responseSchema: ManageWorkspaceUsersResponseSchema,
    tags: ['admin', 'workspaces'],
    timeoutMs: 10000,
  },

  [AnythingLLMAdminEndpointIds.WORKSPACE_CHATS]: {
    id: AnythingLLMAdminEndpointIds.WORKSPACE_CHATS,
    method: 'POST',
    path: '/v1/admin/workspace-chats',
    auth: 'serviceIdentity',
    requestSchema: WorkspaceChatsRequestSchema,
    responseSchema: WorkspaceChatsResponseSchema,
    tags: ['admin', 'workspaces', 'chats'],
    timeoutMs: 30000, // Longer timeout for potentially large data
  },

  // ============================================================
  // System Preferences
  // ============================================================
  [AnythingLLMAdminEndpointIds.UPDATE_PREFERENCES]: {
    id: AnythingLLMAdminEndpointIds.UPDATE_PREFERENCES,
    method: 'POST',
    path: '/v1/admin/preferences',
    auth: 'serviceIdentity',
    requestSchema: UpdatePreferencesRequestSchema,
    responseSchema: UpdatePreferencesResponseSchema,
    tags: ['admin', 'preferences'],
    timeoutMs: 10000,
  },
};

/**
 * Get endpoint definition by ID
 */
export function getEndpointDefinition(
  endpointId: string,
): EndpointDefinition | undefined {
  return AnythingLLMAdminEndpoints[endpointId as AnythingLLMAdminEndpointId];
}

/**
 * Get all endpoints matching given tags
 */
export function getEndpointsByTags(tags: string[]): EndpointDefinition[] {
  return Object.values(AnythingLLMAdminEndpoints).filter((endpoint) =>
    tags.some((tag) => endpoint.tags.includes(tag)),
  );
}

/**
 * Get all endpoint IDs
 */
export function getAllEndpointIds(): string[] {
  return Object.keys(AnythingLLMAdminEndpoints);
}
