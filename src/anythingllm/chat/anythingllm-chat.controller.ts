import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Request,
  Res,
  UseGuards,
  Body,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Response, Request as ExpressRequest } from 'express';
import { randomUUID } from 'crypto';
import { RoleEnum } from '../../roles/roles.enum';
import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { AnythingLLMChatService } from './anythingllm-chat.service';
import { DocumentScopedChatDto } from './dto/document-scoped-chat.dto';

type ExpressRequestWithUser = ExpressRequest & { user?: JwtPayloadType };

@ApiTags('Chat')
@Controller('v1/chat')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AnythingLLMChatController {
  private readonly logger = new Logger(AnythingLLMChatController.name);

  constructor(private readonly chatService: AnythingLLMChatService) {}

  private mapUserToRequesterContext(user: JwtPayloadType): RequesterContextDto {
    const roleId = user.role?.id;
    const roleName = user.role?.name;

    let roles: string[] = [];
    if (roleId === RoleEnum.admin) {
      roles = ['admin'];
    } else if (roleId === RoleEnum.manager) {
      roles = ['manager'];
    } else if (roleId === RoleEnum.user) {
      roles = ['user'];
    } else if (roleName) {
      roles = [roleName];
    }

    return {
      userId: String(user.id),
      roles,
      sessionId: user.sessionId ? String(user.sessionId) : undefined,
      provider: 'system',
    };
  }

  private logChatAuditEvent(params: {
    requestId: string;
    request: ExpressRequestWithUser;
    dto: DocumentScopedChatDto;
    statusCode: number;
    durationMs: number;
  }): void {
    const { requestId, request, dto, statusCode, durationMs } = params;

    // HIPAA: do not log message content or document paths.
    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'keystone-core-api',
        component: 'chat',
        action: 'CHAT_WITH_DOCUMENTS',
        actor: request.user
          ? { type: 'user', id: request.user.id }
          : { type: 'unknown', id: null },
        documentCount: Array.isArray(dto.documentIds)
          ? dto.documentIds.length
          : 0,
        documentIds: Array.isArray(dto.documentIds) ? dto.documentIds : [],
        workspaceSlug: dto.workspaceSlug ?? null,
        threadSlug: dto.threadSlug ?? null,
        success: statusCode < 400,
        statusCode,
        requestId,
        durationMs,
      }),
    );
  }

  @Post('stream')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stream chat scoped to documents (user-only)' })
  @ApiResponse({
    status: 200,
    description: 'Streaming chat response (Server-Sent Events)',
    content: {
      'text/event-stream': {
        schema: {
          type: 'array',
          items: { type: 'object' },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async streamChat(
    @Request() request: ExpressRequestWithUser,
    @Body() dto: DocumentScopedChatDto,
    @Res() response: Response,
  ): Promise<void> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      if (!request.user) {
        throw new ForbiddenException('User authentication required');
      }

      // Enforce user-only access (SYSTEM-103)
      if (request.user.role?.id !== RoleEnum.user) {
        throw new ForbiddenException(
          'Only users can access document-scoped chat',
        );
      }

      const requesterContext = this.mapUserToRequesterContext(request.user);

      // Set SSE headers
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');

      const stream = await this.chatService.streamChatWithDocuments(
        dto,
        requesterContext,
      );

      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          response.write(`data: ${JSON.stringify(value)}\n\n`);

          if ((value as any)?.close) {
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }

      response.end();

      this.logChatAuditEvent({
        requestId,
        request,
        dto,
        statusCode: 200,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Normalize error without leaking PHI
      const statusCode =
        error && typeof error === 'object' && 'getStatus' in error
          ? ((error as any).getStatus?.() ?? 500)
          : 500;

      this.logChatAuditEvent({
        requestId,
        request,
        dto,
        statusCode,
        durationMs,
      });

      // If the error happens after headers are sent, respond as SSE abort event
      if (!response.headersSent) {
        response.setHeader('Content-Type', 'text/event-stream');
      }

      const message =
        error instanceof Error ? error.message : 'Internal server error';

      // Treat validation errors as bad request when possible
      const abortType =
        statusCode === HttpStatus.BAD_REQUEST ? 'abort' : 'abort';

      const errorEvent = `data: ${JSON.stringify({
        id: requestId,
        type: abortType,
        error: message,
        close: true,
      })}\n\n`;

      response.write(errorEvent);
      response.end();

      // Ensure thrown errors from validation still surface in logs
      if (error instanceof BadRequestException) {
        return;
      }
    }
  }
}
