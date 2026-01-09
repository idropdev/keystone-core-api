import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { AnythingLLMWorkspaceService } from '../workspace/anythingllm-workspace.service';
import { AnythingLLMDocumentService } from '../document/anythingllm-document.service';
import { AnythingLLMThreadService } from '../thread/anythingllm-thread.service';
import { ThreadScopedChatService } from './thread-scoped-chat.service';
import { WorkspaceMapperService } from '../provisioning/domain/workspace-mapper.service';
import { AnythingLLMUserMappingRepository } from '../provisioning/infrastructure/persistence/repositories/anythingllm-user-mapping.repository';
import {
  CreateWorkspaceRequestSchema,
  CreateWorkspaceResponseSchema,
  WorkspaceResponseSchema,
  DocumentUploadResponseSchema,
  UploadRawTextRequestSchema,
  CreateThreadRequestSchema,
  ThreadChatRequestSchema,
  ThreadChatResponseSchema,
  ThreadChatsResponseSchema,
  OpenAIChatMessageSchema,
  OpenAIChatCompletionsResponseSchema,
} from '../registry/schemas';
import { UpstreamError } from '../registry/upstream-error';

/**
 * Workspace information
 */
export interface WorkspaceInfo {
  slug: string;
  id?: number;
  name: string;
}

/**
 * Document information
 */
export interface DocumentInfo {
  location: string;
  name: string;
  title?: string;
}

/**
 * Thread information
 */
export interface ThreadInfo {
  slug: string;
  name?: string;
}

/**
 * Chat response
 */
export interface ChatResponse {
  id: string;
  textResponse: string;
  sources?: Array<{ title: string; chunk: string }>;
  error?: string | null;
}

/**
 * Chat history
 */
export interface ChatHistory {
  history: Array<{
    role: string;
    content: string;
    sentAt?: number;
    sources?: Array<{ title: string; chunk: string }>;
  }>;
}

/**
 * Search result
 */
export interface SearchResult {
  text: string;
  source: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Upload options
 */
export interface UploadOptions {
  folderName?: string;
  metadata?: {
    title?: string;
    docAuthor?: string;
    description?: string;
    docSource?: string;
  };
}

/**
 * Chat options
 */
export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Export options
 */
export interface ExportOptions {
  workspaceSlug?: string;
  limit?: number;
}

/**
 * AnythingLLM Adapter Service
 *
 * High-level adapter providing clean API for Keystone features.
 * Composes lower-level services and handles common patterns like
 * workspace lookup, document management, and thread operations.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMAdapterService {
  private readonly logger = new Logger(AnythingLLMAdapterService.name);

  constructor(
    private readonly workspaceService: AnythingLLMWorkspaceService,
    private readonly documentService: AnythingLLMDocumentService,
    private readonly threadService: AnythingLLMThreadService,
    private readonly threadScopedChatService: ThreadScopedChatService,
    private readonly workspaceMapper: WorkspaceMapperService,
    @Optional()
    @Inject(AnythingLLMUserMappingRepository)
    private readonly mappingRepository?: AnythingLLMUserMappingRepository,
  ) {}

  // ============================================================
  // Workspace Management
  // ============================================================

  /**
   * Ensure workspace exists for user, create if needed
   */
  async ensureWorkspaceForUser(
    userId: string,
    workspaceName?: string,
  ): Promise<WorkspaceInfo> {
    // Check if mapping exists
    if (this.mappingRepository) {
      const mapping = await this.mappingRepository.findByKeystoneUserId(userId);
      if (mapping) {
        // Workspace exists, fetch details
        try {
          const workspace = await this.workspaceService.getWorkspace(
            mapping.workspaceSlug,
          );
          return {
            slug: mapping.workspaceSlug,
            id: workspace.data.id,
            name: workspace.data.name,
          };
        } catch (error) {
          this.logger.warn(
            `Workspace ${mapping.workspaceSlug} not found, will create new one`,
          );
        }
      }
    }

    // Generate workspace slug
    const workspaceSlug = this.workspaceMapper.generateWorkspaceSlug(userId);

    // Create workspace
    const request: CreateWorkspaceRequestSchema = {
      name: workspaceName || `Workspace for user ${userId}`,
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

    return {
      slug: result.workspace.slug,
      id: result.workspace.id,
      name: result.workspace.name,
    };
  }

  /**
   * Get workspace for user
   */
  async getWorkspaceForUser(userId: string): Promise<WorkspaceInfo | null> {
    if (!this.mappingRepository) {
      return null;
    }

    const mapping = await this.mappingRepository.findByKeystoneUserId(userId);
    if (!mapping) {
      return null;
    }

    try {
      const workspace = await this.workspaceService.getWorkspace(
        mapping.workspaceSlug,
      );
      return {
        slug: mapping.workspaceSlug,
        id: workspace.data.id,
        name: workspace.data.name,
      };
    } catch (error) {
      this.logger.warn(
        `Workspace ${mapping.workspaceSlug} not found for user ${userId}`,
      );
      return null;
    }
  }

  // ============================================================
  // Document Management
  // ============================================================

  /**
   * Upload document for user
   */
  async uploadDocument(
    userId: string,
    file: File | Buffer,
    fileName: string,
    options?: UploadOptions,
  ): Promise<DocumentInfo> {
    // Use per-user folder convention
    const folderName = options?.folderName || `users/${userId}`;

    const result = await this.documentService.uploadFile(
      file,
      fileName,
      folderName,
    );

    if (
      !result.data.success ||
      !result.data.documents ||
      result.data.documents.length === 0
    ) {
      throw new Error(
        `Failed to upload document: ${result.data.error || 'Unknown error'}`,
      );
    }

    const doc = result.data.documents[0];

    // Attach to user's workspace
    const workspace = await this.getWorkspaceForUser(userId);
    if (workspace) {
      await this.attachDocToWorkspace(workspace.slug, doc.location);
    }

    return {
      location: doc.location,
      name: doc.name,
      title: doc.title,
    };
  }

  /**
   * Upload raw text (e.g., from OCR pipeline)
   */
  async uploadRawText(
    userId: string,
    text: string,
    metadata?: UploadOptions['metadata'],
  ): Promise<DocumentInfo> {
    const folderName = `users/${userId}`;

    const request: UploadRawTextRequestSchema = {
      text,
      metadata: metadata
        ? {
            title: metadata.title,
            docAuthor: metadata.docAuthor,
            description: metadata.description,
            docSource: metadata.docSource || 'OCR pipeline',
          }
        : undefined,
    };

    const result = await this.documentService.uploadRawText(
      request,
      folderName,
    );

    if (
      !result.data.success ||
      !result.data.documents ||
      result.data.documents.length === 0
    ) {
      throw new Error(
        `Failed to upload raw text: ${result.data.error || 'Unknown error'}`,
      );
    }

    const doc = result.data.documents[0];

    // Attach to user's workspace
    const workspace = await this.getWorkspaceForUser(userId);
    if (workspace) {
      await this.attachDocToWorkspace(workspace.slug, doc.location);
    }

    return {
      location: doc.location,
      name: doc.name,
      title: doc.title,
    };
  }

  /**
   * Attach document to workspace embeddings
   */
  async attachDocToWorkspace(
    workspaceSlug: string,
    docPath: string,
  ): Promise<void> {
    const result = await this.workspaceService.updateEmbeddings(workspaceSlug, {
      adds: [docPath],
      deletes: [],
    });

    if (!result.data.success) {
      throw new Error(
        `Failed to attach document to workspace: ${result.data.error || 'Unknown error'}`,
      );
    }
  }

  /**
   * Detach document from workspace embeddings
   */
  async detachDocFromWorkspace(
    workspaceSlug: string,
    docPath: string,
  ): Promise<void> {
    const result = await this.workspaceService.updateEmbeddings(workspaceSlug, {
      adds: [],
      deletes: [docPath],
    });

    if (!result.data.success) {
      throw new Error(
        `Failed to detach document from workspace: ${result.data.error || 'Unknown error'}`,
      );
    }
  }

  // ============================================================
  // Thread Management
  // ============================================================

  /**
   * Create thread in workspace
   */
  async createThread(
    workspaceSlug: string,
    userId: number,
    name?: string,
  ): Promise<ThreadInfo> {
    const request: CreateThreadRequestSchema = {
      name,
      userId,
    };

    const result = await this.threadService.createThread(
      workspaceSlug,
      request,
    );

    if (!result.data.success || !result.data.threadSlug) {
      throw new Error(
        `Failed to create thread: ${result.data.error || 'Unknown error'}`,
      );
    }

    return {
      slug: result.data.threadSlug,
      name,
    };
  }

  /**
   * Send message to thread
   * Uses Pattern 1 (strict scoping) if attachedDocPaths is provided
   */
  async sendThreadMessage(
    workspaceSlug: string,
    threadSlug: string,
    actingUserId: number,
    message: string,
    mode: 'query' | 'chat',
    attachedDocPaths?: string[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    // If documents are attached, use Pattern 1 (strict scoping)
    if (attachedDocPaths && attachedDocPaths.length > 0) {
      const chatMessages: OpenAIChatMessageSchema[] = [
        { role: 'user', content: message },
      ];

      const completion = await this.threadScopedChatService.chatWithScope(
        workspaceSlug,
        chatMessages,
        attachedDocPaths,
        options?.model,
        options?.temperature,
      );

      // Extract response from completion
      const textResponse =
        completion.choices[0]?.message?.content || 'No response generated';

      // Note: OpenAI-compatible responses don't include sources in the message
      // Sources are only available in thread chat responses, not in OpenAI completions
      // If sources are needed, they should be retrieved from the vector search results
      const sources: Array<{ title: string; chunk: string }> | undefined =
        undefined;

      return {
        id: completion.id,
        textResponse,
        sources,
      };
    }

    // Otherwise, use normal thread chat
    const request: ThreadChatRequestSchema = {
      message,
      mode,
      userId: actingUserId,
    };

    const result = await this.threadService.sendMessage(
      workspaceSlug,
      threadSlug,
      request,
    );

    return {
      id: result.data.id,
      textResponse: result.data.textResponse || '',
      sources: result.data.sources?.map((s) => ({
        title: s.title,
        chunk: s.chunk,
      })),
      error: result.data.error,
    };
  }

  /**
   * Send message to thread (streaming)
   */
  async sendThreadMessageStream(
    workspaceSlug: string,
    threadSlug: string,
    actingUserId: number,
    message: string,
    mode: 'query' | 'chat',
    attachedDocPaths?: string[],
  ): Promise<ReadableStream<ChatResponse>> {
    // Note: Streaming with strict scoping is more complex
    // For now, we'll use normal streaming if documents are attached
    // TODO: Implement streaming with Pattern 1 if needed

    const request: ThreadChatRequestSchema = {
      message,
      mode,
      userId: actingUserId,
    };

    const stream = await this.threadService.streamMessage(
      workspaceSlug,
      threadSlug,
      request,
    );

    // Transform stream chunks to ChatResponse format
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue({
          id: chunk.id,
          textResponse: chunk.textResponse || '',
          sources: chunk.sources?.map((s) => ({
            title: s.title,
            chunk: s.chunk,
          })),
          error: chunk.error,
        });
      },
    });

    stream.pipeTo(transformStream.writable);

    return transformStream.readable;
  }

  /**
   * Get thread chat history
   */
  async getThreadHistory(
    workspaceSlug: string,
    threadSlug: string,
  ): Promise<ChatHistory> {
    const result = await this.threadService.getThreadHistory(
      workspaceSlug,
      threadSlug,
    );

    return {
      history: result.data.history.map((msg) => ({
        role: msg.role,
        content: msg.content,
        sentAt: msg.sentAt,
        sources: msg.sources?.map((s) => ({
          title: s.title,
          chunk: s.chunk,
        })),
      })),
    };
  }

  // ============================================================
  // Vector Search with Strict Scoping
  // ============================================================

  /**
   * Search with strict document scoping (Pattern 1)
   */
  async searchWithScope(
    workspaceSlug: string,
    query: string,
    docPaths: string[],
    topN?: number,
  ): Promise<SearchResult[]> {
    const results = await this.threadScopedChatService.searchWithScope(
      workspaceSlug,
      query,
      docPaths,
      topN,
    );

    return results.map((result) => ({
      text: result.text,
      source: result.source,
      score: result.score,
      metadata: result.metadata,
    }));
  }

  /**
   * Chat with strict document scoping (Pattern 1)
   */
  async chatWithScope(
    workspaceSlug: string,
    messages: OpenAIChatMessageSchema[],
    docPaths: string[],
    options?: ChatOptions,
  ): Promise<OpenAIChatCompletionsResponseSchema> {
    return await this.threadScopedChatService.chatWithScope(
      workspaceSlug,
      messages,
      docPaths,
      options?.model,
      options?.temperature,
    );
  }
}
