import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { AnythingLLMWorkspaceService } from './anythingllm-workspace.service';
import { WorkspaceMapperService } from '../provisioning/domain/workspace-mapper.service';
import { AnythingLLMUserMappingRepository } from '../provisioning/infrastructure/persistence/repositories/anythingllm-user-mapping.repository';
import {
  CreateWorkspaceRequestSchema,
  CreateWorkspaceResponseSchema,
} from '../registry/schemas';
import { UpstreamError } from '../registry/upstream-error';

/**
 * AnythingLLM Workspace Provisioning Service
 *
 * Handles workspace creation for users with idempotency.
 * Separate from user provisioning to allow explicit workspace creation.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMWorkspaceProvisioningService {
  private readonly logger = new Logger(
    AnythingLLMWorkspaceProvisioningService.name,
  );

  constructor(
    private readonly workspaceService: AnythingLLMWorkspaceService,
    private readonly workspaceMapper: WorkspaceMapperService,
    @Optional()
    @Inject(AnythingLLMUserMappingRepository)
    private readonly mappingRepository?: AnythingLLMUserMappingRepository,
  ) {}

  /**
   * Provision workspace for user (idempotent)
   *
   * Checks if workspace already exists before creating.
   * Updates mapping repository if workspace is created.
   *
   * @param keystoneUserId - Keystone user ID
   * @param anythingllmUserId - AnythingLLM user ID (required for mapping)
   * @param workspaceName - Optional workspace name
   * @returns Workspace slug
   */
  async provisionWorkspace(
    keystoneUserId: string,
    anythingllmUserId: number,
    workspaceName?: string,
  ): Promise<string> {
    // Check if mapping exists (idempotency check)
    if (this.mappingRepository) {
      const existingMapping =
        await this.mappingRepository.findByKeystoneUserId(keystoneUserId);
      if (existingMapping) {
        this.logger.log(
          `Workspace already exists for user ${keystoneUserId}: ${existingMapping.workspaceSlug}`,
        );
        return existingMapping.workspaceSlug;
      }
    }

    // Generate workspace slug (deterministic, idempotent)
    const workspaceSlug =
      this.workspaceMapper.generateWorkspaceSlug(keystoneUserId);

    // Check if workspace exists in AnythingLLM (idempotency check)
    try {
      const existingWorkspace =
        await this.workspaceService.getWorkspace(workspaceSlug);
      this.logger.log(
        `Workspace ${workspaceSlug} already exists in AnythingLLM`,
      );

      // Update mapping if it doesn't exist
      if (this.mappingRepository) {
        await this.mappingRepository.create({
          keystoneUserId,
          anythingllmUserId,
          workspaceSlug,
        });
      }

      return workspaceSlug;
    } catch (error) {
      // Workspace doesn't exist, create it
      if (
        error instanceof UpstreamError &&
        (error.status === 404 || error.status === 400)
      ) {
        this.logger.log(
          `Creating workspace ${workspaceSlug} for user ${keystoneUserId}`,
        );

        const request: CreateWorkspaceRequestSchema = {
          name: workspaceName || `Workspace for user ${keystoneUserId}`,
          slug: workspaceSlug,
        };

        const response = await this.workspaceService.createWorkspace(request);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to create workspace: ${response.status} - ${errorText}`,
          );
        }

        const result = (await response.json()) as CreateWorkspaceResponseSchema;

        if (!result.workspace) {
          throw new Error(
            `Failed to create workspace: ${result.message || 'Unknown error'}`,
          );
        }

        // Update mapping
        if (this.mappingRepository) {
          await this.mappingRepository.create({
            keystoneUserId,
            anythingllmUserId,
            workspaceSlug,
          });
        }

        this.logger.log(
          `Successfully created workspace ${workspaceSlug} for user ${keystoneUserId}`,
        );

        return workspaceSlug;
      }

      // Re-throw unexpected errors
      throw error;
    }
  }

  /**
   * Get workspace slug for user
   */
  async getWorkspaceSlug(keystoneUserId: string): Promise<string | null> {
    if (!this.mappingRepository) {
      return null;
    }

    const mapping =
      await this.mappingRepository.findByKeystoneUserId(keystoneUserId);
    return mapping ? mapping.workspaceSlug : null;
  }
}
