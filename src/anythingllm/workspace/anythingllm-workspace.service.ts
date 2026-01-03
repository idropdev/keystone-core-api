import { Injectable, Logger } from '@nestjs/common';
import {
  AnythingLLMRegistryClient,
  RegistryCallResult,
} from '../registry/anythingllm-registry-client';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';
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

  constructor(private readonly registryClient: AnythingLLMRegistryClient) {}

  /**
   * Create a new workspace
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async createWorkspace(
    request: CreateWorkspaceRequestSchema,
  ): Promise<RegistryCallResult<CreateWorkspaceResponseSchema>> {
    throw new Error('Non-admin workspace endpoints have been temporarily disabled');
    // return this.registryClient.call<
    //   CreateWorkspaceResponseSchema,
    //   CreateWorkspaceRequestSchema
    // >(AnythingLLMAdminEndpointIds.CREATE_WORKSPACE, { body: request });
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



