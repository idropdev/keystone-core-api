import { Injectable, Logger } from '@nestjs/common';
import {
  AnythingLLMRegistryClient,
  RegistryCallResult,
} from '../registry/anythingllm-registry-client';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';
import {
  CreateThreadRequestSchema,
  CreateThreadResponseSchema,
  UpdateThreadRequestSchema,
  UpdateThreadResponseSchema,
  DeleteThreadResponseSchema,
  ThreadChatsResponseSchema,
  ThreadChatRequestSchema,
  ThreadChatResponseSchema,
  ThreadStreamChatChunkSchema,
} from '../registry/schemas';
import { UpstreamError } from '../registry/upstream-error';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { ResourceContext } from '../../anythingllm-policy/domain/resource-context.entity';

/**
 * AnythingLLM Thread Service
 *
 * Provides typed methods for all AnythingLLM thread operations.
 * Handles thread CRUD, chat, and streaming chat.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMThreadService {
  private readonly logger = new Logger(AnythingLLMThreadService.name);

  constructor(
    private readonly registryClient: AnythingLLMRegistryClient,
    private readonly clientService: AnythingLLMClientService,
    private readonly orchestratorService: AnythingLLMOrchestratorService,
  ) {}

  /**
   * Create a new thread in a workspace
   * Supports delegated token (user JWT) or service identity authentication
   *
   * @param workspaceSlug - Workspace slug
   * @param request - Thread creation request
   * @param requesterContext - User context if JWT present (optional)
   * @returns Upstream response from AnythingLLM
   */
  async createThread(
    workspaceSlug: string,
    request: CreateThreadRequestSchema,
    requesterContext?: RequesterContextDto,
  ): Promise<Response> {
    const path = `/v1/workspace/${encodeURIComponent(workspaceSlug)}/thread/new`;

    // Route based on authentication type
    if (requesterContext) {
      // User JWT present → use orchestrator (policy check + delegated token)
      // Pass workspaceSlug in resourceContext for policy authorization
      const resourceContext: ResourceContext = {
        workspaceSlug,
      };

      return this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.THREAD_CREATE,
        requesterContext,
        resourceContext,
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
   * Update thread name
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async updateThread(
    workspaceSlug: string,
    threadSlug: string,
    request: UpdateThreadRequestSchema,
  ): Promise<RegistryCallResult<UpdateThreadResponseSchema>> {
    throw new Error(
      'Non-admin thread endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<
    //   UpdateThreadResponseSchema,
    //   UpdateThreadRequestSchema
    // >(AnythingLLMAdminEndpointIds.UPDATE_THREAD, {
    //   params: { slug: workspaceSlug, threadSlug },
    //   body: request,
    // });
  }

  /**
   * Delete a thread
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async deleteThread(
    workspaceSlug: string,
    threadSlug: string,
  ): Promise<RegistryCallResult<DeleteThreadResponseSchema>> {
    throw new Error(
      'Non-admin thread endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<DeleteThreadResponseSchema>(
    //   AnythingLLMAdminEndpointIds.DELETE_THREAD,
    //   { params: { slug: workspaceSlug, threadSlug } },
    // );
  }

  /**
   * Get thread chat history
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async getThreadHistory(
    workspaceSlug: string,
    threadSlug: string,
  ): Promise<RegistryCallResult<ThreadChatsResponseSchema>> {
    throw new Error(
      'Non-admin thread endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<ThreadChatsResponseSchema>(
    //   AnythingLLMAdminEndpointIds.GET_THREAD_CHATS,
    //   { params: { slug: workspaceSlug, threadSlug } },
    // );
  }

  /**
   * Send a message to a thread (non-streaming)
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async sendMessage(
    workspaceSlug: string,
    threadSlug: string,
    request: ThreadChatRequestSchema,
  ): Promise<RegistryCallResult<ThreadChatResponseSchema>> {
    throw new Error(
      'Non-admin thread endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<
    //   ThreadChatResponseSchema,
    //   ThreadChatRequestSchema
    // >(AnythingLLMAdminEndpointIds.THREAD_CHAT, {
    //   params: { slug: workspaceSlug, threadSlug },
    //   body: request,
    // });
  }

  /**
   * Send a message to a thread (streaming)
   * Returns a ReadableStream for Server-Sent Events
   * Supports delegated token (user JWT) or service identity authentication
   *
   * @param workspaceSlug - Workspace slug
   * @param threadSlug - Thread slug
   * @param request - Chat request
   * @param requesterContext - User context if JWT present (optional)
   * @returns ReadableStream of chat chunks
   */
  async streamMessage(
    workspaceSlug: string,
    threadSlug: string,
    request: ThreadChatRequestSchema,
    requesterContext?: RequesterContextDto,
  ): Promise<ReadableStream<ThreadStreamChatChunkSchema>> {
    const path = `/v1/workspace/${encodeURIComponent(workspaceSlug)}/thread/${encodeURIComponent(threadSlug)}/stream-chat`;

    try {
      let response: Response;

      // Route based on authentication type
      if (requesterContext) {
        // User JWT present → use orchestrator (policy check + delegated token)
        // Pass workspaceSlug and threadSlug in resourceContext for policy authorization
        const resourceContext: ResourceContext = {
          workspaceSlug,
          threadSlug,
        };

        response = await this.orchestratorService.executeOperation({
          operation: AnythingLLMOperation.THREAD_CHAT,
          requesterContext,
          resourceContext,
          endpoint: path,
          method: 'POST',
          body: request,
          headers: {
            Accept: 'text/event-stream',
          },
        });
      } else {
        // Service identity → call client directly (bypass policy)
        response = await this.clientService.callAnythingLLM(path, {
          method: 'POST',
          body: JSON.stringify(request),
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
        });
      }

      if (!response.ok) {
        throw await UpstreamError.fromResponse(
          response,
          'stream-chat',
          path,
          request,
        );
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Create a transform stream to parse SSE events
      const decoder = new TextDecoder();
      let buffer = '';
      let chunkCount = 0;

      const transformStream = new TransformStream({
        transform(chunk, controller) {
          chunkCount++;
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(
                  line.slice(6),
                ) as ThreadStreamChatChunkSchema;
                controller.enqueue(data);
              } catch (error) {
                this.logger.warn(
                  `Failed to parse SSE chunk: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              }
            }
          }
        },
        flush(controller) {
          if (buffer.trim()) {
            if (buffer.startsWith('data: ')) {
              try {
                const data = JSON.parse(
                  buffer.slice(6),
                ) as ThreadStreamChatChunkSchema;
                controller.enqueue(data);
              } catch (error) {
                this.logger.warn(
                  `Failed to parse final SSE chunk: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              }
            }
          }
        },
      });

      response.body.pipeTo(transformStream.writable);

      return transformStream.readable;
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw error;
      }
      throw UpstreamError.fromNetworkError(
        error instanceof Error ? error : new Error(String(error)),
        'stream-chat',
        path,
        request,
      );
    }
  }
}
