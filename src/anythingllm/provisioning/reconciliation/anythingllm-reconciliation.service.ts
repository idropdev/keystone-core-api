import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { AnythingLLMOrchestratorService } from '../../../anythingllm-orchestrator/service';
import { AnythingLLMOperation } from '../../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { AnythingLLMUserMappingRepository } from '../infrastructure/persistence/repositories/anythingllm-user-mapping.repository';
import { AnythingLLMUserMappingEntity } from '../infrastructure/persistence/relational/entities/anythingllm-user-mapping.entity';

/**
 * Reconciliation Report Interface
 */
export interface ReconciliationReport {
  orphanedMappings: Array<{
    mappingId: number;
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceSlug: string;
  }>;
  orphanedAnythingLLMUsers: Array<{
    anythingllmUserId: number;
    externalId: string;
    username: string;
  }>;
  usersWithoutWorkspaces: Array<{
    mappingId: number;
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceSlug: string;
  }>;
  timestamp: Date;
}

/**
 * AnythingLLM Reconciliation Service
 *
 * Detects and reports inconsistencies between Keystone and AnythingLLM:
 * - Orphaned mappings (mapping exists but AnythingLLM user doesn't)
 * - Orphaned AnythingLLM users (user exists but no mapping)
 * - Users without workspace assignments
 *
 * CRITICAL: All AnythingLLM API calls MUST use delegated tokens (HS256) via orchestrator
 * with admin context (system admin ID: 1) when no user context is available.
 * NEVER use service identity (RS256) tokens.
 */
@Injectable()
export class AnythingLLMReconciliationService {
  private readonly logger = new Logger(AnythingLLMReconciliationService.name);
  // System admin ID for reconciliation operations (when no user context available)
  private readonly SYSTEM_ADMIN_ID = 1;

  constructor(
    private readonly orchestratorService: AnythingLLMOrchestratorService,
    @Optional()
    @Inject(AnythingLLMUserMappingRepository)
    private readonly mappingRepository?: AnythingLLMUserMappingRepository,
  ) {}

  /**
   * Get admin context for delegated tokens
   * Used when no user context is available
   */
  private getAdminContext(): RequesterContextDto {
    return {
      userId: String(this.SYSTEM_ADMIN_ID),
      roles: ['admin'],
    };
  }

  /**
   * Find orphaned mappings
   * Mappings where AnythingLLM user doesn't exist
   *
   * Uses delegated token with admin context via orchestrator.
   * Calls /v1/admin/users/external/{id} with HS256 token.
   *
   * @returns Array of orphaned mappings
   */
  async findOrphanedMappings(): Promise<
    Array<{
      mappingId: number;
      keystoneUserId: string;
      anythingllmUserId: number;
      workspaceSlug: string;
    }>
  > {
    if (!this.mappingRepository) {
      this.logger.warn(
        'Mapping repository not available - reconciliation cannot run',
      );
      return [];
    }

    const orphanedMappings: Array<{
      mappingId: number;
      keystoneUserId: string;
      anythingllmUserId: number;
      workspaceSlug: string;
    }> = [];

    try {
      // Get all mappings
      const allMappings = await this.mappingRepository.findAll();

      // Check each mapping to see if AnythingLLM user exists
      for (const mapping of allMappings) {
        try {
          const requesterContext = this.getAdminContext();

          const response = await this.orchestratorService.executeOperation({
            requesterContext,
            operation: AnythingLLMOperation.SYSTEM_READ,
            endpoint: `/v1/admin/users/external/${mapping.keystoneUserId}?provider=keystone`,
            method: 'GET',
          });

          if (!response.ok) {
            // User doesn't exist (404) or other error - mapping is orphaned
            if (response.status === 404) {
              orphanedMappings.push({
                mappingId: mapping.id,
                keystoneUserId: mapping.keystoneUserId,
                anythingllmUserId: mapping.anythingllmUserId,
                workspaceSlug: mapping.workspaceSlug,
              });
            }
          }
        } catch (error) {
          // Error checking user - assume orphaned
          this.logger.warn(
            `Failed to check AnythingLLM user for mapping ${mapping.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          orphanedMappings.push({
            mappingId: mapping.id,
            keystoneUserId: mapping.keystoneUserId,
            anythingllmUserId: mapping.anythingllmUserId,
            workspaceSlug: mapping.workspaceSlug,
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to find orphaned mappings: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }

    return orphanedMappings;
  }

  /**
   * Find orphaned AnythingLLM users
   * AnythingLLM users with externalId=keystone but no mapping
   *
   * Uses delegated token with admin context via orchestrator.
   * Calls /v1/admin/users with HS256 token.
   *
   * @returns Array of orphaned AnythingLLM users
   */
  async findOrphanedAnythingLLMUsers(): Promise<
    Array<{
      anythingllmUserId: number;
      externalId: string;
      username: string;
    }>
  > {
    if (!this.mappingRepository) {
      this.logger.warn(
        'Mapping repository not available - reconciliation cannot run',
      );
      return [];
    }

    const orphanedUsers: Array<{
      anythingllmUserId: number;
      externalId: string;
      username: string;
    }> = [];

    try {
      const requesterContext = this.getAdminContext();

      // Get all AnythingLLM users
      const response = await this.orchestratorService.executeOperation({
        requesterContext,
        operation: AnythingLLMOperation.SYSTEM_READ,
        endpoint: '/v1/admin/users',
        method: 'GET',
      });

      if (!response.ok) {
        this.logger.error(
          `Failed to list AnythingLLM users: ${response.status}`,
        );
        return [];
      }

      const data = await response.json();
      const users = data.users || [];

      // Check each user with externalId=keystone
      for (const user of users) {
        if (
          user.externalId &&
          user.externalProvider === 'keystone' &&
          user.externalId
        ) {
          // Check if mapping exists
          const mapping = await this.mappingRepository.findByAnythingLLMUserId(
            user.id,
          );

          if (!mapping) {
            // User exists in AnythingLLM but no mapping - orphaned
            orphanedUsers.push({
              anythingllmUserId: user.id,
              externalId: user.externalId,
              username: user.username || 'unknown',
            });
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to find orphaned AnythingLLM users: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }

    return orphanedUsers;
  }

  /**
   * Find users without workspace assignments
   * Provisioned users that don't have workspace assignments
   *
   * Uses delegated token with admin context via orchestrator.
   *
   * @returns Array of users without workspace assignments
   */
  async findUsersWithoutWorkspaces(): Promise<
    Array<{
      mappingId: number;
      keystoneUserId: string;
      anythingllmUserId: number;
      workspaceSlug: string;
    }>
  > {
    if (!this.mappingRepository) {
      this.logger.warn(
        'Mapping repository not available - reconciliation cannot run',
      );
      return [];
    }

    const usersWithoutWorkspaces: Array<{
      mappingId: number;
      keystoneUserId: string;
      anythingllmUserId: number;
      workspaceSlug: string;
    }> = [];

    try {
      // Get all mappings
      const allMappings = await this.mappingRepository.findAll();

      // Check each mapping to see if user has workspace assignment
      for (const mapping of allMappings) {
        try {
          const requesterContext = this.getAdminContext();

          // Check if workspace exists and user is assigned
          // We'll check by trying to get workspace users
          const response = await this.orchestratorService.executeOperation({
            requesterContext,
            operation: AnythingLLMOperation.SYSTEM_READ,
            endpoint: `/v1/admin/workspaces/${mapping.workspaceSlug}`,
            method: 'GET',
          });

          if (!response.ok) {
            // Workspace doesn't exist or user not assigned
            if (response.status === 404) {
              usersWithoutWorkspaces.push({
                mappingId: mapping.id,
                keystoneUserId: mapping.keystoneUserId,
                anythingllmUserId: mapping.anythingllmUserId,
                workspaceSlug: mapping.workspaceSlug,
              });
            }
          } else {
            // Check if user is in workspace
            const workspaceData = await response.json();
            const users = workspaceData.users || [];

            const userInWorkspace = users.some(
              (u: any) => u.userId === mapping.anythingllmUserId,
            );

            if (!userInWorkspace) {
              usersWithoutWorkspaces.push({
                mappingId: mapping.id,
                keystoneUserId: mapping.keystoneUserId,
                anythingllmUserId: mapping.anythingllmUserId,
                workspaceSlug: mapping.workspaceSlug,
              });
            }
          }
        } catch (error) {
          // Error checking workspace - assume issue
          this.logger.warn(
            `Failed to check workspace for mapping ${mapping.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          usersWithoutWorkspaces.push({
            mappingId: mapping.id,
            keystoneUserId: mapping.keystoneUserId,
            anythingllmUserId: mapping.anythingllmUserId,
            workspaceSlug: mapping.workspaceSlug,
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to find users without workspaces: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }

    return usersWithoutWorkspaces;
  }

  /**
   * Main reconciliation method (detection only, no auto-fix)
   *
   * Uses delegated token with admin context for all AnythingLLM API calls.
   *
   * @returns Reconciliation report
   */
  async reconcile(): Promise<ReconciliationReport> {
    this.logger.log('Starting reconciliation process');

    const [orphanedMappings, orphanedUsers, usersWithoutWorkspaces] =
      await Promise.all([
        this.findOrphanedMappings(),
        this.findOrphanedAnythingLLMUsers(),
        this.findUsersWithoutWorkspaces(),
      ]);

    const report: ReconciliationReport = {
      orphanedMappings,
      orphanedAnythingLLMUsers: orphanedUsers,
      usersWithoutWorkspaces,
      timestamp: new Date(),
    };

    this.logger.log(
      `Reconciliation complete: ${orphanedMappings.length} orphaned mappings, ${orphanedUsers.length} orphaned users, ${usersWithoutWorkspaces.length} users without workspaces`,
    );

    return report;
  }

  /**
   * Fix orphaned mapping
   * Deletes the orphaned mapping
   *
   * Uses delegated token with admin context.
   *
   * @param mappingId - Mapping ID to delete
   */
  async fixOrphanedMapping(mappingId: number): Promise<void> {
    if (!this.mappingRepository) {
      throw new Error('Mapping repository not available');
    }

    try {
      await this.mappingRepository.delete(mappingId);
      this.logger.log(`Deleted orphaned mapping ${mappingId}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete orphaned mapping ${mappingId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  /**
   * Fix orphaned AnythingLLM user
   * Suspends the orphaned user in AnythingLLM
   *
   * Uses delegated token with admin context via orchestrator.
   *
   * @param anythingllmUserId - AnythingLLM user ID to suspend
   */
  async fixOrphanedUser(anythingllmUserId: number): Promise<void> {
    try {
      const requesterContext = this.getAdminContext();

      // Suspend user in AnythingLLM
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
        throw new Error(
          `Failed to suspend orphaned user ${anythingllmUserId}: ${response.status}`,
        );
      }

      this.logger.log(
        `Suspended orphaned AnythingLLM user ${anythingllmUserId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to suspend orphaned user ${anythingllmUserId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }
}
