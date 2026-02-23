import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { AccessGrantDomainService } from '../../access-control/domain/services/access-grant.domain.service';
import { DocumentAnythingLLMPathRepository } from '../provisioning/infrastructure/persistence/repositories/document-anythingllm-path.repository';
import { ThreadStreamChatChunkSchema } from '../registry/schemas';
import { DocumentScopedChatDto } from './dto/document-scoped-chat.dto';

@Injectable()
export class AnythingLLMChatService {
  private readonly logger = new Logger(AnythingLLMChatService.name);

  constructor(
    private readonly orchestratorService: AnythingLLMOrchestratorService,
    private readonly accessGrantService: AccessGrantDomainService,
    private readonly documentAnythingLLMPathRepository: DocumentAnythingLLMPathRepository,
  ) {}

  async streamChatWithDocuments(
    dto: DocumentScopedChatDto,
    requesterContext: RequesterContextDto,
  ): Promise<ReadableStream<ThreadStreamChatChunkSchema>> {
    const workspaceSlug = dto.workspaceSlug?.trim();
    if (!workspaceSlug) {
      throw new BadRequestException('workspaceSlug is required');
    }

    const requesterUserId = parseInt(requesterContext.userId, 10);
    if (isNaN(requesterUserId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const documentIds = (dto.documentIds || []).map((id) => id.trim());
    const isFullScope =
      documentIds.length === 0 ||
      (documentIds.length === 1 && documentIds[0] === '*') ||
      documentIds.includes('*');

    let documentPaths: string[];

    if (isFullScope) {
      documentPaths = ['*'];
    } else {
      // Validate format early for clean errors (but allow upstream changes if needed)
      const invalidIds = documentIds.filter((id) => !isUUID(id, 4));
      if (invalidIds.length > 0) {
        throw new BadRequestException('documentIds must be UUIDv4 or "*"');
      }

      // Access control: user can only chat with documents where they are temporaryManager or have AccessGrant
      for (const documentId of documentIds) {
        const hasAccess = await this.accessGrantService.hasAccess(
          documentId,
          'user',
          requesterUserId,
        );

        if (!hasAccess) {
          throw new ForbiddenException(
            'User does not have access to one or more documents',
          );
        }
      }

      const mappings =
        await this.documentAnythingLLMPathRepository.findByDocumentIdsAndWorkspaceSlug(
          documentIds,
          workspaceSlug,
        );

      const mappingByDocumentId = new Map(
        mappings.map((m) => [m.documentId, m.anythingllmDocPath] as const),
      );

      const missingMappings = documentIds.filter(
        (documentId) => !mappingByDocumentId.has(documentId),
      );

      if (missingMappings.length > 0) {
        throw new BadRequestException(
          'Document not available for chat (missing AnythingLLM path mapping)',
        );
      }

      documentPaths = documentIds.map((documentId) => {
        return mappingByDocumentId.get(documentId) as string;
      });
    }

    const upstreamResponse = await this.orchestratorService.executeOperation({
      operation: AnythingLLMOperation.CHAT_WITH_DOCS,
      requesterContext,
      resourceContext: { workspaceSlug },
      endpoint: `/v1/workspace/${encodeURIComponent(workspaceSlug)}/stream-chat`,
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
      },
      body: {
        message: dto.message,
        documentPaths,
        threadSlug: dto.threadSlug,
      },
    });

    if (!upstreamResponse.ok) {
      // Avoid leaking PHI: do not log message/document paths
      const errorText = await upstreamResponse.text();
      this.logger.warn(
        `Upstream AnythingLLM stream-chat failed: status=${upstreamResponse.status} body=${errorText.substring(0, 200)}`,
      );
      throw new BadRequestException('Upstream chat request failed');
    }

    if (!upstreamResponse.body) {
      throw new BadRequestException('Upstream response body is null');
    }

    return this.parseSseStream(upstreamResponse.body);
  }

  private parseSseStream(
    upstreamBody: ReadableStream<Uint8Array>,
  ): ReadableStream<ThreadStreamChatChunkSchema> {
    const decoder = new TextDecoder();
    const logger = this.logger;
    let buffer = '';

    const transformStream = new TransformStream<
      Uint8Array,
      ThreadStreamChatChunkSchema
    >({
      transform(chunk, controller) {
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
              logger.warn(
                `Failed to parse SSE chunk: ${
                  error instanceof Error ? error.message : 'Unknown error'
                }`,
              );
            }
          }
        }
      },
      flush(controller) {
        if (buffer.trim() && buffer.startsWith('data: ')) {
          try {
            const data = JSON.parse(
              buffer.slice(6),
            ) as ThreadStreamChatChunkSchema;
            controller.enqueue(data);
          } catch (error) {
            logger.warn(
              `Failed to parse final SSE chunk: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`,
            );
          }
        }
      },
    });

    void upstreamBody.pipeTo(transformStream.writable);
    return transformStream.readable;
  }
}
