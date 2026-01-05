import { Injectable, Logger, HttpException } from '@nestjs/common';
import {
  AnythingLLMRegistryClient,
  RegistryCallResult,
} from '../registry/anythingllm-registry-client';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import {
  CreateWorkspaceRequestSchema,
  CreateWorkspaceResponseSchema,
  ListWorkspacesResponseSchema,
  WorkspaceResponseSchema,
  UpdateWorkspaceRequestSchema,
  UpdateWorkspaceResponseSchema,
  DeleteWorkspaceResponseSchema,
  UpdateWorkspaceEmbeddingsRequestSchema,
  UpdateWorkspaceEmbeddingsResponseSchema,
  UpdateWorkspacePinRequestSchema,
  UpdateWorkspacePinResponseSchema,
} from '../registry/schemas';

/**
 * AnythingLLM Workspace Service
 *
 * Provides typed methods for all AnythingLLM workspace operations.
 * Uses the registry client for consistent request handling and error normalization.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMWorkspaceService {
  private readonly logger = new Logger(AnythingLLMWorkspaceService.name);

  constructor(
    private readonly registryClient: AnythingLLMRegistryClient,
    private readonly orchestratorService: AnythingLLMOrchestratorService,
    private readonly clientService: AnythingLLMClientService,
  ) {}

  /**
   * Create a new workspace
   * Supports delegated token (user JWT) or service identity authentication
   *
   * @param request - Workspace creation request
   * @param requesterContext - User context if JWT present (optional)
   * @returns Upstream response from AnythingLLM
   */
  async createWorkspace(
    request: CreateWorkspaceRequestSchema,
    requesterContext?: RequesterContextDto,
  ): Promise<Response> {
    const path = '/v1/workspace/new';

    // Route based on authentication type
    if (requesterContext) {
      // User JWT present → use orchestrator (policy check + delegated token)
      return this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.WORKSPACE_CREATE,
        requesterContext,
        endpoint: path,
        method: 'POST',
        body: request,
      });
    } else {
      // Service identity → call client directly (bypass policy)
      return this.clientService.callAnythingLLM(path, {
        method: 'POST',
        body: JSON.stringify(request),
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }

  /**
   * List all workspaces
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async listWorkspaces(): Promise<
    RegistryCallResult<ListWorkspacesResponseSchema>
  > {
    throw new Error('Non-admin workspace endpoints have been temporarily disabled');
    // return this.registryClient.call<ListWorkspacesResponseSchema>(
    //   AnythingLLMAdminEndpointIds.LIST_WORKSPACES,
    // );
  }

  /**
   * Get workspace by slug
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async getWorkspace(
    slug: string,
  ): Promise<RegistryCallResult<WorkspaceResponseSchema>> {
    throw new Error('Non-admin workspace endpoints have been temporarily disabled');
    // return this.registryClient.call<WorkspaceResponseSchema>(
    //   AnythingLLMAdminEndpointIds.GET_WORKSPACE,
    //   { params: { slug } },
    // );
  }

  /**
   * Update workspace settings
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async updateWorkspace(
    slug: string,
    request: UpdateWorkspaceRequestSchema,
  ): Promise<RegistryCallResult<UpdateWorkspaceResponseSchema>> {
    throw new Error('Non-admin workspace endpoints have been temporarily disabled');
    // return this.registryClient.call<
    //   UpdateWorkspaceResponseSchema,
    //   UpdateWorkspaceRequestSchema
    // >(AnythingLLMAdminEndpointIds.UPDATE_WORKSPACE, {
    //   params: { slug },
    //   body: request,
    // });
  }

  /**
   * Delete workspace
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async deleteWorkspace(
    slug: string,
  ): Promise<RegistryCallResult<DeleteWorkspaceResponseSchema>> {
    throw new Error('Non-admin workspace endpoints have been temporarily disabled');
    // return this.registryClient.call<DeleteWorkspaceResponseSchema>(
    //   AnythingLLMAdminEndpointIds.DELETE_WORKSPACE,
    //   { params: { slug } },
    // );
  }

  /**
   * Update workspace embeddings (add/remove documents)
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async updateEmbeddings(
    slug: string,
    request: UpdateWorkspaceEmbeddingsRequestSchema,
  ): Promise<RegistryCallResult<UpdateWorkspaceEmbeddingsResponseSchema>> {
    throw new Error('Non-admin workspace endpoints have been temporarily disabled');
    // return this.registryClient.call<
    //   UpdateWorkspaceEmbeddingsResponseSchema,
    //   UpdateWorkspaceEmbeddingsRequestSchema
    // >(AnythingLLMAdminEndpointIds.UPDATE_WORKSPACE_EMBEDDINGS, {
    //   params: { slug },
    //   body: request,
    // });
  }

  /**
   * Update document pin status in workspace
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async updatePin(
    slug: string,
    request: UpdateWorkspacePinRequestSchema,
  ): Promise<RegistryCallResult<UpdateWorkspacePinResponseSchema>> {
    throw new Error('Non-admin workspace endpoints have been temporarily disabled');
    // return this.registryClient.call<
    //   UpdateWorkspacePinResponseSchema,
    //   UpdateWorkspacePinRequestSchema
    // >(AnythingLLMAdminEndpointIds.UPDATE_WORKSPACE_PIN, {
    //   params: { slug },
    //   body: request,
    // });
  }
}



