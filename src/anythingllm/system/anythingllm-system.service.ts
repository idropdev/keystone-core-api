import { Injectable, Logger } from '@nestjs/common';
import {
  AnythingLLMRegistryClient,
  RegistryCallResult,
} from '../registry/anythingllm-registry-client';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { AnythingLLMSystemEndpointIds } from '../registry/anythingllm-endpoints.registry';
import {
  AuthCheckResponseSchema,
  CheckTokenResponseSchema,
  SystemInfoResponseSchema,
  VectorCountResponseSchema,
  WorkspaceCountResponseSchema,
  DocumentCountResponseSchema,
} from '../registry/schemas';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { randomUUID } from 'crypto';

/**
 * AnythingLLM System Service
 *
 * Provides typed methods for all AnythingLLM system operations.
 *
 * Authentication Strategy:
 * - ALWAYS uses service-to-service authentication (Keystone → AnythingLLM)
 * - When user context is available (user/manager/admin JWT present):
 *   → Uses delegated token with service identity (sub: 'svc-keystone')
 *   → Embeds user context in act claim (userId, roles: ['admin'|'manager'|'user'])
 * - When no user context:
 *   → Uses pure service identity (GCP OIDC token)
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMSystemService {
  private readonly logger = new Logger(AnythingLLMSystemService.name);

  constructor(
    private readonly registryClient: AnythingLLMRegistryClient,
    private readonly orchestratorService: AnythingLLMOrchestratorService,
  ) {}

  /**
   * Check authentication
   *
   * Always uses service-to-service authentication:
   * - With user context: Delegated token (sub: 'svc-keystone', act: {userId, roles})
   * - Without user context: Service identity (GCP OIDC token)
   */
  async checkAuth(
    requesterContext?: RequesterContextDto,
  ): Promise<RegistryCallResult<AuthCheckResponseSchema>> {
    const requestId = randomUUID();

    if (requesterContext) {
      // Service-to-service with delegated token embedding user context (user/manager/admin)
      // Token structure: { sub: 'svc-keystone', act: { sub: userId, roles: [...] } }
      const response = await this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.SYSTEM_AUTH_CHECK,
        requesterContext,
        endpoint: '/v1/auth',
        method: 'GET',
      });

      const data = (await response.json()) as AuthCheckResponseSchema;

      // Normalize response - only return { authenticated: true/false }
      const normalizedData: AuthCheckResponseSchema = {
        authenticated: data.authenticated === true,
      };

      return {
        data: normalizedData,
        requestId,
        status: response.status,
      };
    } else {
      // Service-to-service with pure service identity (no user context)
      const result = await this.registryClient.call<AuthCheckResponseSchema>(
        AnythingLLMSystemEndpointIds.AUTH_CHECK,
      );

      // Normalize response
      const normalizedData: AuthCheckResponseSchema = {
        authenticated: result.data.authenticated === true,
      };

      return {
        ...result,
        data: normalizedData,
      };
    }
  }

  /**
   * Check token validity
   *
   * Always uses service-to-service authentication:
   * - With user context: Delegated token (sub: 'svc-keystone', act: {userId, roles})
   * - Without user context: Service identity (GCP OIDC token)
   */
  async checkToken(
    requesterContext?: RequesterContextDto,
  ): Promise<RegistryCallResult<CheckTokenResponseSchema>> {
    if (requesterContext) {
      // Service-to-service with delegated token embedding user context (user/manager/admin)
      // Token structure: { sub: 'svc-keystone', act: { sub: userId, roles: [...] } }
      const response = await this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.SYSTEM_AUTH_CHECK,
        requesterContext,
        endpoint: '/v1/system/check-token',
        method: 'GET',
      });

      const data = (await response.json()) as any;

      // Normalize response - only return { authenticated: true/false }
      const normalizedData: CheckTokenResponseSchema = {
        authenticated: data.valid === true || data.authenticated === true,
      };

      return {
        data: normalizedData,
        requestId: randomUUID(),
        status: response.status,
      };
    } else {
      // Service-to-service with pure service identity (no user context)
      const result = await this.registryClient.call<CheckTokenResponseSchema>(
        AnythingLLMSystemEndpointIds.CHECK_TOKEN,
      );

      // Normalize response
      const normalizedData: CheckTokenResponseSchema = {
        authenticated:
          result.data.authenticated === true ||
          (result.data as any).valid === true,
      };

      return {
        ...result,
        data: normalizedData,
      };
    }
  }

  /**
   * Get system information
   *
   * Always uses service-to-service authentication:
   * - With user context: Delegated token (sub: 'svc-keystone', act: {userId, roles})
   * - Without user context: Service identity (GCP OIDC token)
   */
  async getSystemInfo(
    requesterContext?: RequesterContextDto,
  ): Promise<RegistryCallResult<SystemInfoResponseSchema>> {
    if (requesterContext) {
      // Service-to-service with delegated token embedding user context (user/manager/admin)
      // Token structure: { sub: 'svc-keystone', act: { sub: userId, roles: [...] } }
      const response = await this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.SYSTEM_READ,
        requesterContext,
        endpoint: '/v1/system',
        method: 'GET',
      });

      const data = (await response.json()) as SystemInfoResponseSchema;

      return {
        data,
        requestId: randomUUID(),
        status: response.status,
      };
    } else {
      // Service-to-service with pure service identity (no user context, no policy check)
      return this.registryClient.call<SystemInfoResponseSchema>(
        AnythingLLMSystemEndpointIds.SYSTEM_INFO,
      );
    }
  }

  /**
   * Get vector count
   *
   * Always uses service-to-service authentication:
   * - With user context: Delegated token (sub: 'svc-keystone', act: {userId, roles})
   * - Without user context: Service identity (GCP OIDC token)
   */
  async getVectorCount(
    requesterContext?: RequesterContextDto,
  ): Promise<RegistryCallResult<VectorCountResponseSchema>> {
    if (requesterContext) {
      // Service-to-service with delegated token embedding user context (user/manager/admin)
      // Token structure: { sub: 'svc-keystone', act: { sub: userId, roles: [...] } }
      const response = await this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.VECTOR_COUNT_READ,
        requesterContext,
        endpoint: '/v1/system/vector-count',
        method: 'GET',
      });

      const data = (await response.json()) as VectorCountResponseSchema;

      return {
        data,
        requestId: randomUUID(),
        status: response.status,
      };
    } else {
      // Service-to-service with pure service identity (no user context, no policy check)
      return this.registryClient.call<VectorCountResponseSchema>(
        AnythingLLMSystemEndpointIds.VECTOR_COUNT,
      );
    }
  }

  /**
   * Get workspace count
   *
   * Always uses service-to-service authentication:
   * - With user context: Delegated token (sub: 'svc-keystone', act: {userId, roles})
   * - Without user context: Service identity (GCP OIDC token)
   */
  async getWorkspaceCount(
    requesterContext?: RequesterContextDto,
  ): Promise<RegistryCallResult<WorkspaceCountResponseSchema>> {
    if (requesterContext) {
      // Service-to-service with delegated token embedding user context (user/manager/admin)
      // Token structure: { sub: 'svc-keystone', act: { sub: userId, roles: [...] } }
      const response = await this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.WORKSPACE_COUNT_READ,
        requesterContext,
        endpoint: '/v1/system/workspace-count',
        method: 'GET',
      });

      const data = (await response.json()) as WorkspaceCountResponseSchema;

      return {
        data,
        requestId: randomUUID(),
        status: response.status,
      };
    } else {
      // Service-to-service with pure service identity (no user context, no policy check)
      return this.registryClient.call<WorkspaceCountResponseSchema>(
        AnythingLLMSystemEndpointIds.WORKSPACE_COUNT,
      );
    }
  }

  /**
   * Get document count
   *
   * Always uses service-to-service authentication:
   * - With user context: Delegated token (sub: 'svc-keystone', act: {userId, roles})
   * - Without user context: Service identity (GCP OIDC token)
   */
  async getDocumentCount(
    requesterContext?: RequesterContextDto,
  ): Promise<RegistryCallResult<DocumentCountResponseSchema>> {
    if (requesterContext) {
      // Service-to-service with delegated token embedding user context (user/manager/admin)
      // Token structure: { sub: 'svc-keystone', act: { sub: userId, roles: [...] } }
      const response = await this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.DOCUMENT_COUNT_READ,
        requesterContext,
        endpoint: '/v1/system/document-count',
        method: 'GET',
      });

      const data = (await response.json()) as DocumentCountResponseSchema;

      return {
        data,
        requestId: randomUUID(),
        status: response.status,
      };
    } else {
      // Service-to-service with pure service identity (no user context, no policy check)
      return this.registryClient.call<DocumentCountResponseSchema>(
        AnythingLLMSystemEndpointIds.DOCUMENT_COUNT,
      );
    }
  }
}
