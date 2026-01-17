import { Injectable, Logger } from '@nestjs/common';
import { AnythingLLMThreadService } from '../thread/anythingllm-thread.service';
import { AnythingLLMAdminService } from './anythingllm-admin.service';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';
import {
  ThreadChatsResponseSchema,
  ThreadChatRequestSchema,
  ExportChatsResponseSchema,
  WorkspaceChatsRequestSchema,
} from '../registry/schemas';
import { UpstreamError } from '../registry/upstream-error';

/**
 * Chat query options
 */
export interface ChatQueryOptions {
  apiSessionId?: string;
  limit?: number;
  orderBy?: 'asc' | 'desc';
}

/**
 * Export options
 */
export interface ExportOptions {
  workspaceSlug?: string;
  limit?: number;
}

/**
 * AnythingLLM Admin Oversight Service
 *
 * Provides admin/system-level observability of user conversations.
 * Supports thread history access, manager note injection, and chat export.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMAdminOversightService {
  private readonly logger = new Logger(AnythingLLMAdminOversightService.name);

  constructor(
    private readonly threadService: AnythingLLMThreadService,
    private readonly adminService: AnythingLLMAdminService,
    private readonly clientService: AnythingLLMClientService,
  ) {}

  /**
   * Get thread history for admin oversight
   */
  async getThreadHistory(
    workspaceSlug: string,
    threadSlug: string,
  ): Promise<ThreadChatsResponseSchema> {
    const result = await this.threadService.getThreadHistory(
      workspaceSlug,
      threadSlug,
    );
    return result.data;
  }

  /**
   * Get workspace-level chats (all threads in workspace)
   */
  async getWorkspaceChats(
    _workspaceSlug: string,
    _options?: ChatQueryOptions,
  ): Promise<any> {
    // Use admin workspace chats endpoint
    const request: WorkspaceChatsRequestSchema = {
      offset: 0, // TODO: Add pagination support
    };

    const result = await this.adminService.getWorkspaceChats(request);
    return result.data;
  }

  /**
   * Export chats for compliance/audit
   */
  async exportChats(
    options?: ExportOptions,
  ): Promise<ExportChatsResponseSchema> {
    const path = '/v1/system/export-chats';

    try {
      const response = await this.clientService.callAnythingLLM(path, {
        method: 'GET',
      });

      if (!response.ok) {
        throw await UpstreamError.fromResponse(
          response,
          'export-chats',
          path,
          options,
        );
      }

      const data = (await response.json()) as ExportChatsResponseSchema;
      return data;
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw error;
      }
      throw UpstreamError.fromNetworkError(
        error instanceof Error ? error : new Error(String(error)),
        'export-chats',
        path,
        options,
      );
    }
  }

  /**
   * Inject manager note into thread
   *
   * Strategy A: Manager note as a normal message with special prefix
   * This keeps the audit trail inside the thread.
   */
  async injectManagerNote(
    workspaceSlug: string,
    threadSlug: string,
    managerUserId: number,
    note: string,
    noteType: 'MANAGER NOTE' | 'CORRECTION' | 'CLARIFICATION' = 'MANAGER NOTE',
  ): Promise<void> {
    const prefixedNote = `${noteType}: ${note}`;

    const request: ThreadChatRequestSchema = {
      message: prefixedNote,
      mode: 'chat', // Use chat mode for manager notes
      userId: managerUserId,
    };

    const result = await this.threadService.sendMessage(
      workspaceSlug,
      threadSlug,
      request,
    );

    if (result.data.error) {
      throw new Error(`Failed to inject manager note: ${result.data.error}`);
    }

    this.logger.log(
      `Manager note injected into thread ${threadSlug} by user ${managerUserId}`,
    );
  }
}
