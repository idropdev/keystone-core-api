import { Injectable, Logger, ForbiddenException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnythingLLMOperation } from './domain/anythingllm-operation.enum';
import { ResourceContext } from './domain/resource-context.entity';
import { PermissionRule } from './domain/permission-rule.entity';
import {
  AuthorizeOperationDto,
  AuthorizeOperationResponseDto,
  RequesterContextDto,
} from './dto/authorize-operation.dto';
import { AccessGrantDomainService } from '../access-control/domain/services/access-grant.domain.service';
import { UserManagerAssignmentService } from '../users/domain/services/user-manager-assignment.service';
import { AnythingLLMUserMappingRepository } from '../anythingllm/provisioning/infrastructure/persistence/repositories/anythingllm-user-mapping.repository';
import { RoleEnum } from '../roles/roles.enum';
import { AllConfigType } from '../config/config.type';

/**
 * Policy service for AnythingLLM operations
 * Evaluates role permissions + resource ownership before allowing operations
 */
@Injectable()
export class AnythingLLMPolicyService {
  private readonly logger = new Logger(AnythingLLMPolicyService.name);

  constructor(
    private readonly accessGrantService: AccessGrantDomainService,
    private readonly userManagerAssignmentService: UserManagerAssignmentService,
    private readonly configService: ConfigService<AllConfigType>,
    @Optional()
    private readonly mappingRepository?: AnythingLLMUserMappingRepository,
  ) {}

  /**
   * Authorize an operation based on requester context, operation type, and resource context
   *
   * @param dto - Authorization request
   * @returns Authorization result with allowed status and scopes
   */
  async authorizeOperation(
    dto: AuthorizeOperationDto,
  ): Promise<AuthorizeOperationResponseDto> {
    const { requesterContext, operation, resourceContext } = dto;

    // Extract role IDs from roles array (roles are strings like "user", "manager", "admin")
    const roleIds = this.extractRoleIds(requesterContext.roles);
    const isAdmin = roleIds.includes(RoleEnum.admin);
    const isManager = roleIds.includes(RoleEnum.manager);
    const isUser = roleIds.includes(RoleEnum.user);

    // Check operation-specific authorization
    switch (operation) {
      case AnythingLLMOperation.THREAD_CHAT:
        return this.authorizeThreadChat(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.THREAD_CREATE:
        return this.authorizeThreadCreate(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.THREAD_LIST:
        return this.authorizeThreadList(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.THREAD_HISTORY:
        return this.authorizeThreadHistory(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.THREAD_EXPORT:
        return this.authorizeThreadExport(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.THREAD_ADMIN_VIEW:
        return this.authorizeThreadAdminView(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
        );

      case AnythingLLMOperation.VECTOR_SEARCH:
        return this.authorizeVectorSearch(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.DOCUMENT_UPLOAD:
        return this.authorizeDocumentUpload(
          requesterContext,
          resourceContext,
          isManager,
          isUser,
          isAdmin,
        );

      case AnythingLLMOperation.WORKSPACE_CREATE:
        return this.authorizeWorkspaceCreate(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.WORKSPACE_LIST:
        return this.authorizeWorkspaceList(
          requesterContext,
          resourceContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.SYSTEM_AUTH_CHECK:
        return this.authorizeSystemAuthCheck(
          requesterContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.SYSTEM_READ:
        return this.authorizeSystemRead(
          requesterContext,
          isAdmin,
          isManager,
          isUser,
        );

      case AnythingLLMOperation.VECTOR_COUNT_READ:
      case AnythingLLMOperation.WORKSPACE_COUNT_READ:
      case AnythingLLMOperation.DOCUMENT_COUNT_READ:
        return this.authorizeSystemCountRead(
          requesterContext,
          isAdmin,
          isManager,
          isUser,
        );

      default:
        return {
          allowed: false,
          scope: [],
          reason: `Unknown operation: ${operation}`,
        };
    }
  }

  /**
   * Authorize THREAD_CHAT operation
   * User: own threads only
   * Manager: own threads + assigned users' threads
   * Admin: all threads
   */
  private async authorizeThreadChat(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    if (isAdmin) {
      return {
        allowed: true,
        scope: ['anythingllm:thread:chat'],
      };
    }

    if (!resourceContext?.workspaceSlug || !resourceContext?.threadSlug) {
      return {
        allowed: false,
        scope: [],
        reason: 'workspaceSlug and threadSlug required',
      };
    }

    const requesterUserId = parseInt(requesterContext.userId, 10);
    if (isNaN(requesterUserId)) {
      return {
        allowed: false,
        scope: [],
        reason: 'Invalid user ID',
      };
    }

    // Check thread ownership
    const hasAccess = await this.checkThreadAccess(
      requesterUserId,
      resourceContext.workspaceSlug,
      resourceContext.threadSlug,
      isManager,
    );

    if (!hasAccess) {
      return {
        allowed: false,
        scope: [],
        reason: 'User does not have access to this thread',
      };
    }

    return {
      allowed: true,
      scope: ['anythingllm:thread:chat'],
    };
  }

  /**
   * Authorize THREAD_CREATE operation
   * User: own workspace
   * Manager: own workspace + assigned users' workspaces
   * Admin: all workspaces
   */
  private async authorizeThreadCreate(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    if (isAdmin) {
      return {
        allowed: true,
        scope: ['anythingllm:thread:create'],
      };
    }

    if (!resourceContext?.workspaceSlug) {
      return {
        allowed: false,
        scope: [],
        reason: 'workspaceSlug required',
      };
    }

    const requesterUserId = parseInt(requesterContext.userId, 10);
    if (isNaN(requesterUserId)) {
      return {
        allowed: false,
        scope: [],
        reason: 'Invalid user ID',
      };
    }

    // Check workspace access
    const hasAccess = await this.checkWorkspaceAccess(
      requesterUserId,
      resourceContext.workspaceSlug,
      isManager,
    );

    if (!hasAccess) {
      return {
        allowed: false,
        scope: [],
        reason: 'User does not have access to this workspace',
      };
    }

    return {
      allowed: true,
      scope: ['anythingllm:thread:create'],
    };
  }

  /**
   * Authorize THREAD_LIST operation
   * User: own threads only
   * Manager: own threads + assigned users' threads
   * Admin: all threads
   */
  private async authorizeThreadList(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    if (isAdmin) {
      return {
        allowed: true,
        scope: ['anythingllm:thread:read', 'anythingllm:thread:list'],
      };
    }

    // List operations are allowed but results will be filtered by workspace ownership
    // The actual filtering happens in the adapter/service layer
    return {
      allowed: true,
      scope: ['anythingllm:thread:read', 'anythingllm:thread:list'],
    };
  }

  /**
   * Authorize THREAD_HISTORY operation
   * User: own threads only
   * Manager: own threads + assigned users' threads
   * Admin: all threads
   */
  private async authorizeThreadHistory(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    if (isAdmin) {
      return {
        allowed: true,
        scope: ['anythingllm:thread:read', 'anythingllm:thread:history'],
      };
    }

    if (!resourceContext?.workspaceSlug || !resourceContext?.threadSlug) {
      return {
        allowed: false,
        scope: [],
        reason: 'workspaceSlug and threadSlug required',
      };
    }

    const requesterUserId = parseInt(requesterContext.userId, 10);
    if (isNaN(requesterUserId)) {
      return {
        allowed: false,
        scope: [],
        reason: 'Invalid user ID',
      };
    }

    // Check thread access
    const hasAccess = await this.checkThreadAccess(
      requesterUserId,
      resourceContext.workspaceSlug,
      resourceContext.threadSlug,
      isManager,
    );

    if (!hasAccess) {
      return {
        allowed: false,
        scope: [],
        reason: 'User does not have access to this thread',
      };
    }

    return {
      allowed: true,
      scope: ['anythingllm:thread:read', 'anythingllm:thread:history'],
    };
  }

  /**
   * Authorize THREAD_EXPORT operation
   * User: own threads only
   * Manager: own threads + assigned users' threads
   * Admin: all threads
   */
  private async authorizeThreadExport(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    if (isAdmin) {
      return {
        allowed: true,
        scope: ['anythingllm:thread:read', 'anythingllm:thread:export'],
      };
    }

    if (!resourceContext?.workspaceSlug || !resourceContext?.threadSlug) {
      return {
        allowed: false,
        scope: [],
        reason: 'workspaceSlug and threadSlug required',
      };
    }

    const requesterUserId = parseInt(requesterContext.userId, 10);
    if (isNaN(requesterUserId)) {
      return {
        allowed: false,
        scope: [],
        reason: 'Invalid user ID',
      };
    }

    // Check thread access
    const hasAccess = await this.checkThreadAccess(
      requesterUserId,
      resourceContext.workspaceSlug,
      resourceContext.threadSlug,
      isManager,
    );

    if (!hasAccess) {
      return {
        allowed: false,
        scope: [],
        reason: 'User does not have access to this thread',
      };
    }

    return {
      allowed: true,
      scope: ['anythingllm:thread:read', 'anythingllm:thread:export'],
    };
  }

  /**
   * Authorize THREAD_ADMIN_VIEW operation (Manager oversight)
   * User: denied
   * Manager: assigned users' threads
   * Admin: all threads
   */
  private async authorizeThreadAdminView(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    if (isAdmin) {
      return {
        allowed: true,
        scope: ['anythingllm:thread:read', 'anythingllm:thread:history'],
      };
    }

    if (!isManager) {
      return {
        allowed: false,
        scope: [],
        reason: 'Only managers and admins can view thread history for oversight',
      };
    }

    if (!resourceContext?.targetUserId) {
      return {
        allowed: false,
        scope: [],
        reason: 'targetUserId required for manager oversight',
      };
    }

    const requesterUserId = parseInt(requesterContext.userId, 10);
    const targetUserId = parseInt(resourceContext.targetUserId as string, 10);

    if (isNaN(requesterUserId) || isNaN(targetUserId)) {
      return {
        allowed: false,
        scope: [],
        reason: 'Invalid user ID',
      };
    }

    // Check if user is assigned to manager
    const isAssigned = await this.userManagerAssignmentService.isManagerAssignedToUser(
      requesterUserId,
      targetUserId,
    );

    if (!isAssigned) {
      return {
        allowed: false,
        scope: [],
        reason: 'User is not assigned to this manager',
      };
    }

    return {
      allowed: true,
      scope: ['anythingllm:thread:read', 'anythingllm:thread:history'],
    };
  }

  /**
   * Authorize VECTOR_SEARCH operation
   * User: scoped to accessible documents
   * Manager: scoped to accessible documents
   * Admin: all documents
   */
  private async authorizeVectorSearch(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    if (isAdmin) {
      return {
        allowed: true,
        scope: ['anythingllm:vector:search'],
      };
    }

    if (!resourceContext?.documentId) {
      // If no document ID specified, allow but scope will be applied at query time
      return {
        allowed: true,
        scope: ['anythingllm:vector:search'],
      };
    }

    const requesterUserId = parseInt(requesterContext.userId, 10);
    if (isNaN(requesterUserId)) {
      return {
        allowed: false,
        scope: [],
        reason: 'Invalid user ID',
      };
    }

    // Check document access via AccessGrantDomainService
    const actorType = isManager ? ('manager' as const) : ('user' as const);
    const hasAccess = await this.accessGrantService.hasAccess(
      resourceContext.documentId as string,
      actorType,
      requesterUserId,
    );

    if (!hasAccess) {
      return {
        allowed: false,
        scope: [],
        reason: 'User does not have access to this document',
      };
    }

    return {
      allowed: true,
      scope: ['anythingllm:vector:search'],
    };
  }

  /**
   * Authorize DOCUMENT_UPLOAD operation
   * Admin: Allowed
   * Manager: Allowed
   * User: Denied
   * Service Identity: Bypass (handled separately)
   */
  private async authorizeDocumentUpload(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isManager: boolean,
    isUser: boolean,
    isAdmin: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    // Admin and Manager are allowed
    if (isAdmin || isManager) {
      return {
        allowed: true,
        scope: ['anythingllm:document:upload'],
      };
    }

    // Users are denied
    if (isUser) {
      return {
        allowed: false,
        scope: [],
        reason: 'Users cannot upload documents to AnythingLLM',
      };
    }

    // Default deny for unknown roles
    return {
      allowed: false,
      scope: [],
      reason: 'Insufficient permissions for document upload',
    };
  }

  /**
   * Authorize WORKSPACE_CREATE operation
   * User: own workspace
   * Manager: own workspace + assigned users' workspaces
   * Admin: all workspaces
   */
  private async authorizeWorkspaceCreate(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    // Workspace creation is generally allowed (workspace provisioning handles ownership)
    return {
      allowed: true,
      scope: ['anythingllm:workspace:create'],
    };
  }

  /**
   * Authorize WORKSPACE_LIST operation
   * User: own workspace only
   * Manager: own workspace + assigned users' workspaces
   * Admin: all workspaces
   */
  private async authorizeWorkspaceList(
    requesterContext: RequesterContextDto,
    resourceContext: ResourceContext | undefined,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    // List operations are allowed but results will be filtered by workspace ownership
    return {
      allowed: true,
      scope: ['anythingllm:workspace:read', 'anythingllm:workspace:list'],
    };
  }

  /**
   * Check if requester has access to a workspace
   */
  private async checkWorkspaceAccess(
    requesterUserId: number,
    workspaceSlug: string,
    isManager: boolean,
  ): Promise<boolean> {
    if (!this.mappingRepository) {
      // If mapping repository is not available, allow (fallback for development)
      this.logger.warn(
        'AnythingLLMUserMappingRepository not available, allowing workspace access',
      );
      return true;
    }

    // Get workspace owner
    const workspaceMappings = await this.mappingRepository.findByWorkspaceSlug(
      workspaceSlug,
    );

    if (workspaceMappings.length === 0) {
      return false;
    }

    // Check if requester owns the workspace
    const requesterUserIdStr = String(requesterUserId);
    const ownsWorkspace = workspaceMappings.some(
      (mapping) => mapping.keystoneUserId === requesterUserIdStr,
    );

    if (ownsWorkspace) {
      return true;
    }

      // If manager, check if any workspace owner is assigned to this manager
      if (isManager && this.userManagerAssignmentService) {
        for (const mapping of workspaceMappings) {
          const workspaceOwnerId = parseInt(mapping.keystoneUserId, 10);
          if (!isNaN(workspaceOwnerId)) {
            const isAssigned = await this.userManagerAssignmentService.isManagerAssignedToUser(
              requesterUserId,
              workspaceOwnerId,
            );
            if (isAssigned) {
              return true;
            }
          }
        }
      }

    return false;
  }

  /**
   * Check if requester has access to a thread
   * Threads belong to workspaces, so we check workspace access
   */
  private async checkThreadAccess(
    requesterUserId: number,
    workspaceSlug: string,
    threadSlug: string,
    isManager: boolean,
  ): Promise<boolean> {
    // Threads belong to workspaces, so check workspace access
    return this.checkWorkspaceAccess(requesterUserId, workspaceSlug, isManager);
  }

  /**
   * Authorize SYSTEM_AUTH_CHECK operation
   * All authenticated users allowed
   */
  private async authorizeSystemAuthCheck(
    requesterContext: RequesterContextDto,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    // All authenticated users allowed
    return {
      allowed: true,
      scope: ['anythingllm:system:auth'],
    };
  }

  /**
   * Authorize SYSTEM_READ operation
   * Admin/Manager: always allowed
   * User: check SYSTEM_VISIBILITY_ALLOW_USERS config flag
   */
  private async authorizeSystemRead(
    requesterContext: RequesterContextDto,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    // Admin/Manager: always allowed
    if (isAdmin || isManager) {
      return {
        allowed: true,
        scope: ['anythingllm:system:read'],
      };
    }

    // User: check SYSTEM_VISIBILITY_ALLOW_USERS config flag
    if (isUser) {
      const systemVisibilityAllowUsers = this.configService.get<boolean>(
        'anythingllm.systemVisibilityAllowUsers',
        { infer: true },
      ) ?? false;

      if (systemVisibilityAllowUsers) {
        return {
          allowed: true,
          scope: ['anythingllm:system:read'],
        };
      }

      return {
        allowed: false,
        scope: [],
        reason: 'System visibility not allowed for users',
      };
    }

    return {
      allowed: false,
      scope: [],
      reason: 'Invalid role',
    };
  }

  /**
   * Authorize system count read operations
   * Same as SYSTEM_READ
   */
  private async authorizeSystemCountRead(
    requesterContext: RequesterContextDto,
    isAdmin: boolean,
    isManager: boolean,
    isUser: boolean,
  ): Promise<AuthorizeOperationResponseDto> {
    // Same as SYSTEM_READ
    return this.authorizeSystemRead(
      requesterContext,
      isAdmin,
      isManager,
      isUser,
    );
  }

  /**
   * Extract role IDs from roles array
   * Roles can be strings like "user", "manager", "admin" or role IDs
   */
  private extractRoleIds(roles: string[]): number[] {
    return roles
      .map((role) => {
        // Check if role is a role name (string)
        if (role === 'admin') return RoleEnum.admin;
        if (role === 'user') return RoleEnum.user;
        if (role === 'manager') return RoleEnum.manager;

        // Check if role is a role ID (number as string)
        const roleId = parseInt(role, 10);
        if (!isNaN(roleId)) return roleId;

        return null;
      })
      .filter((id): id is number => id !== null);
  }
}

