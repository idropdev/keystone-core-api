import {
  Controller,
  Post,
  Get,
  Delete,
  UseGuards,
  Body,
  Request,
  Param,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
  Res,
  Optional,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserThrottlerGuard } from './guards/user-throttler.guard';
import { Response, Request as ExpressRequest } from 'express';
import { AnythingLLMWorkspaceService } from './anythingllm-workspace.service';
import { AnythingLLMThreadService } from '../thread/anythingllm-thread.service';
import { AnythingLLMUserProvisioningService } from '../provisioning/anythingllm-user-provisioning.service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { RoleEnum } from '../../roles/roles.enum';
import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';
import {
  CreateWorkspaceRequestSchema,
  CreateWorkspaceResponseSchema,
  CreateThreadRequestSchema,
  CreateThreadResponseSchema,
  ThreadChatRequestSchema,
} from '../registry/schemas';
import { randomUUID } from 'crypto';

type ExpressRequestWithUser = ExpressRequest & { user?: JwtPayloadType };

/**
 * AnythingLLM Workspace Controller
 *
 * User-facing controller for workspace endpoints requiring JWT authentication.
 *
 * Authentication Strategy:
 * - REQUIRES valid JWT token (HS256) for all requests
 * - Extracts user context (userId, roles) from JWT
 * - Uses delegated token with service identity (sub: 'svc-keystone')
 * - Embeds user context in act claim: { sub: userId, roles: ['admin'|'manager'|'user'] }
 *
 * Security:
 * - All endpoints require valid JWT authentication
 * - Invalid or missing tokens are rejected with 401 Unauthorized
 *
 * HIPAA Compliance:
 * - Never logs tokens or sensitive authentication data
 * - All errors are normalized to prevent information leakage
 */
@ApiTags('AnythingLLM Workspace')
@Controller('anythingllm/v1/workspace')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AnythingLLMWorkspaceController {
  private readonly logger = new Logger(AnythingLLMWorkspaceController.name);

  constructor(
    private readonly workspaceService: AnythingLLMWorkspaceService,
    private readonly threadService: AnythingLLMThreadService,
    @Optional()
    private readonly provisioningService?: AnythingLLMUserProvisioningService,
  ) {}

  /**
   * Map JWT payload to RequesterContextDto
   */
  private mapUserToRequesterContext(user: JwtPayloadType): RequesterContextDto {
    const roleId = user.role?.id;
    const roleName = user.role?.name;

    // Map role ID to role name string
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
      provider: 'system', // Default provider for JWT tokens
    };
  }

  /**
   * Log endpoint call for audit trail
   * HIPAA-compliant: Never logs tokens or sensitive authentication data
   */
  private logEndpointCall(
    endpoint: string,
    operation: AnythingLLMOperation,
    request: ExpressRequestWithUser,
    statusCode: number,
    durationMs: number,
    requestId: string,
  ): void {
    const userId = request.user?.id || null;
    const sessionId = request.user?.sessionId || null;
    const actorType = request.user ? 'user' : 'service';

    // Extract roles only if delegated token (from JWT payload)
    const roles = request.user?.role
      ? [request.user.role.name || String(request.user.role.id)]
      : [];

    this.logger.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'keystone-core-api',
        component: 'anythingllm-workspace',
        event: operation,
        endpoint,
        operation,
        userId,
        sessionId,
        actorType,
        roles,
        success: statusCode < 400,
        statusCode,
        requestId,
        durationMs,
      }),
    );
  }

  /**
   * Handle errors and map upstream status codes
   */
  private handleError(error: unknown): HttpException {
    if (error instanceof HttpException) {
      return error;
    }

    // Check if it's a Response object (from fetch)
    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as { status: number }).status;
      if (status === 401) {
        return new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      }
      if (status === 403) {
        return new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      if (status === 500) {
        return new HttpException(
          'Workspace creation failed',
          HttpStatus.BAD_GATEWAY,
        );
      }
    }

    // Network errors
    if (error instanceof Error) {
      if (
        error.message.includes('fetch') ||
        error.message.includes('network') ||
        error.message.includes('ECONNREFUSED')
      ) {
        return new HttpException(
          'Service unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }

    // Generic error
    return new HttpException(
      'Internal server error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Post('new')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a new workspace',
    description:
      'Create a new workspace in AnythingLLM with optional configuration settings.',
  })
  @ApiResponse({
    status: 200,
    description: 'Workspace created successfully',
    type: CreateWorkspaceResponseSchema,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({
    status: 502,
    description: 'Bad Gateway - upstream processing failed',
  })
  @ApiResponse({ status: 503, description: 'Service Unavailable' })
  async createWorkspace(
    @Request() request: ExpressRequestWithUser,
    @Body() body: CreateWorkspaceRequestSchema,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreateWorkspaceResponseSchema> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      // Extract requester context if user JWT is present
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      // Call service to create workspace
      const upstreamResponse = await this.workspaceService.createWorkspace(
        body,
        requesterContext,
      );

      // Parse upstream response
      let upstreamData: CreateWorkspaceResponseSchema;
      if (!upstreamResponse.ok) {
        // Handle error responses
        const errorText = await upstreamResponse.text();
        try {
          upstreamData = JSON.parse(errorText) as CreateWorkspaceResponseSchema;
        } catch {
          // If not JSON, create error response
          throw new HttpException(
            'Workspace creation failed',
            HttpStatus.BAD_GATEWAY,
          );
        }

        const durationMs = Date.now() - startTime;
        this.logEndpointCall(
          '/v1/workspace/new',
          AnythingLLMOperation.WORKSPACE_CREATE,
          request,
          upstreamResponse.status,
          durationMs,
          requestId,
        );

        // Map upstream error status codes
        if (upstreamResponse.status === 401) {
          throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
        }
        if (upstreamResponse.status === 403) {
          throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
        }
        if (upstreamResponse.status === 500) {
          throw new HttpException(
            'Workspace creation failed',
            HttpStatus.BAD_GATEWAY,
          );
        }
        throw new HttpException(
          'Workspace creation failed',
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Parse successful response
      upstreamData =
        (await upstreamResponse.json()) as CreateWorkspaceResponseSchema;

      // Ensure message is set if it's missing or null
      if (!upstreamData.message) {
        upstreamData.message = 'Workspace created';
      }

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/workspace/new',
        AnythingLLMOperation.WORKSPACE_CREATE,
        request,
        upstreamResponse.status,
        durationMs,
        requestId,
      );

      return upstreamData;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const httpError = this.handleError(error);

      // Log error (HIPAA-compliant, no sensitive data)
      this.logEndpointCall(
        '/v1/workspace/new',
        AnythingLLMOperation.WORKSPACE_CREATE,
        request,
        httpError.getStatus(),
        durationMs,
        requestId,
      );

      throw httpError;
    }
  }

  @Post(':slug/thread/new')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a new thread in a workspace',
    description:
      'Create a new thread in the specified workspace with optional name, slug, and userId.',
  })
  @ApiResponse({
    status: 200,
    description: 'Thread created successfully',
    type: CreateThreadResponseSchema,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({
    status: 502,
    description: 'Bad Gateway - upstream processing failed',
  })
  @ApiResponse({ status: 503, description: 'Service Unavailable' })
  async createThread(
    @Request() request: ExpressRequestWithUser,
    @Param('slug') workspaceSlug: string,
    @Body() body: CreateThreadRequestSchema,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CreateThreadResponseSchema> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      // Extract requester context if user JWT is present
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      // Call service to create thread
      const upstreamResponse = await this.threadService.createThread(
        workspaceSlug,
        body,
        requesterContext,
      );

      // Parse upstream response
      let upstreamData: CreateThreadResponseSchema;
      if (!upstreamResponse.ok) {
        // Handle error responses
        const errorText = await upstreamResponse.text();
        try {
          upstreamData = JSON.parse(errorText) as CreateThreadResponseSchema;
        } catch {
          // If not JSON, create error response
          throw new HttpException(
            'Thread creation failed',
            HttpStatus.BAD_GATEWAY,
          );
        }

        const durationMs = Date.now() - startTime;
        this.logEndpointCall(
          `/v1/workspace/${workspaceSlug}/thread/new`,
          AnythingLLMOperation.THREAD_CREATE,
          request,
          upstreamResponse.status,
          durationMs,
          requestId,
        );

        // Map upstream error status codes
        if (upstreamResponse.status === 401) {
          throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
        }
        if (upstreamResponse.status === 403) {
          throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
        }
        if (upstreamResponse.status === 500) {
          throw new HttpException(
            'Thread creation failed',
            HttpStatus.BAD_GATEWAY,
          );
        }
        throw new HttpException(
          'Thread creation failed',
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Parse successful response
      upstreamData =
        (await upstreamResponse.json()) as CreateThreadResponseSchema;

      // Record thread creation in the database (for audit and tracking)
      // This is done asynchronously and doesn't block the response
      if (
        this.provisioningService &&
        request.user &&
        upstreamData.thread?.slug
      ) {
        // Fire and forget - don't await to avoid blocking the response
        this.provisioningService
          .recordUserThread({
            keystoneUserId: request.user.id,
            workspaceSlug,
            threadSlug: upstreamData.thread.slug,
            threadName: body.name,
          })
          .catch((error) => {
            // Log error but don't fail the request
            this.logger.warn(
              `Failed to record thread ${upstreamData.thread.slug} for user ${request.user?.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          });
      }

      // Ensure message is set if it's missing (it's optional in the schema)
      // The schema defines message as optional, so we don't need to set it if undefined

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        `/v1/workspace/${workspaceSlug}/thread/new`,
        AnythingLLMOperation.THREAD_CREATE,
        request,
        upstreamResponse.status,
        durationMs,
        requestId,
      );

      return upstreamData;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const httpError = this.handleError(error);

      // Log error (HIPAA-compliant, no sensitive data)
      this.logEndpointCall(
        `/v1/workspace/${workspaceSlug}/thread/new`,
        AnythingLLMOperation.THREAD_CREATE,
        request,
        httpError.getStatus(),
        durationMs,
        requestId,
      );

      throw httpError;
    }
  }

  @Get(':slug/threads')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'List threads in a workspace for the authenticated user',
    description:
      "Returns thread metadata for the authenticated user's threads in the specified workspace, sourced from keystone's local mirror table (upstream AnythingLLM has no list-threads endpoint).",
  })
  @ApiResponse({ status: 200, description: 'Threads listed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — workspace does not belong to the user',
  })
  async listThreads(
    @Request() request: ExpressRequestWithUser,
    @Param('slug') workspaceSlug: string,
  ): Promise<unknown> {
    if (!request.user) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    const userId = request.user.id;

    if (!this.provisioningService) {
      throw new HttpException(
        'Provisioning service not available',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const mapping =
      await this.provisioningService.getWorkspaceMappingForUser(userId);
    if (!mapping || mapping.workspaceSlug !== workspaceSlug) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    return this.threadService.listThreads(workspaceSlug, userId);
  }

  @Delete(':slug/thread/:threadSlug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Delete a thread (proxies upstream + soft-deletes local mirror)',
  })
  @ApiResponse({ status: 204, description: 'Thread deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Thread not found' })
  async deleteThread(
    @Request() request: ExpressRequestWithUser,
    @Param('slug') workspaceSlug: string,
    @Param('threadSlug') threadSlug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    const requesterContext = request.user
      ? this.mapUserToRequesterContext(request.user)
      : undefined;

    const upstreamResponse = await this.threadService.deleteThread(
      workspaceSlug,
      threadSlug,
      requesterContext,
    );
    const durationMs = Date.now() - startTime;
    this.logEndpointCall(
      `/v1/workspace/${workspaceSlug}/thread/${threadSlug}`,
      AnythingLLMOperation.THREAD_DELETE,
      request,
      upstreamResponse.status,
      durationMs,
      requestId,
    );

    if (!upstreamResponse.ok) {
      if (upstreamResponse.status === 401) {
        throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      }
      if (upstreamResponse.status === 403) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      if (upstreamResponse.status === 404) {
        throw new HttpException('Thread not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException('Delete failed', HttpStatus.BAD_GATEWAY);
    }
  }

  @Get(':slug/thread/:threadSlug/chats')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get thread chat history' })
  @ApiResponse({ status: 200, description: 'Chat history returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Thread not found' })
  async getThreadChats(
    @Request() request: ExpressRequestWithUser,
    @Param('slug') workspaceSlug: string,
    @Param('threadSlug') threadSlug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<unknown> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    const requesterContext = request.user
      ? this.mapUserToRequesterContext(request.user)
      : undefined;

    const upstreamResponse = await this.threadService.getThreadHistory(
      workspaceSlug,
      threadSlug,
      requesterContext,
    );
    const durationMs = Date.now() - startTime;
    this.logEndpointCall(
      `/v1/workspace/${workspaceSlug}/thread/${threadSlug}/chats`,
      AnythingLLMOperation.THREAD_HISTORY,
      request,
      upstreamResponse.status,
      durationMs,
      requestId,
    );

    if (!upstreamResponse.ok) {
      if (upstreamResponse.status === 401) {
        throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
      }
      if (upstreamResponse.status === 403) {
        throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      }
      if (upstreamResponse.status === 404) {
        throw new HttpException('Thread not found', HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch chat history',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return upstreamResponse.json();
  }

  @Post(':slug/thread/:threadSlug/stream-chat')
  @UseGuards(AuthGuard('jwt'), UserThrottlerGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stream chat with a workspace thread',
    description:
      'Send a prompt to the workspace thread and receive streaming LLM responses as Server-Sent Events (SSE).',
  })
  @ApiResponse({
    status: 200,
    description: 'Streaming chat response (Server-Sent Events)',
    content: {
      'text/event-stream': {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'uuid-123' },
              type: {
                type: 'string',
                enum: ['abort', 'textResponseChunk'],
                example: 'textResponseChunk',
              },
              textResponse: { type: 'string', example: 'First chunk' },
              sources: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    chunk: { type: 'string' },
                  },
                },
              },
              close: { type: 'boolean', example: false },
              error: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({
    status: 502,
    description: 'Bad Gateway - upstream processing failed',
  })
  @ApiResponse({ status: 503, description: 'Service Unavailable' })
  async streamChat(
    @Request() request: ExpressRequestWithUser,
    @Param('slug') workspaceSlug: string,
    @Param('threadSlug') threadSlug: string,
    @Body() body: ThreadChatRequestSchema,
    @Res() response: Response,
  ): Promise<void> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      // Extract requester context if user JWT is present
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      // Set SSE headers
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');

      // Get streaming response from service
      const stream = await this.threadService.streamMessage(
        workspaceSlug,
        threadSlug,
        body,
        requesterContext,
      );

      // Convert ReadableStream chunks to SSE format and write to response
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Format as SSE: "data: {json}\n\n"
          const sseData = `data: ${JSON.stringify(value)}\n\n`;
          response.write(sseData);

          // If stream is closed, break
          if (value.close) {
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }

      // End the response
      response.end();

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        `/v1/workspace/${workspaceSlug}/thread/${threadSlug}/stream-chat`,
        AnythingLLMOperation.THREAD_CHAT,
        request,
        200,
        durationMs,
        requestId,
      );
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const httpError = this.handleError(error);

      // Log error (HIPAA-compliant, no sensitive data)
      this.logEndpointCall(
        `/v1/workspace/${workspaceSlug}/thread/${threadSlug}/stream-chat`,
        AnythingLLMOperation.THREAD_CHAT,
        request,
        httpError.getStatus(),
        durationMs,
        requestId,
      );

      // Send error as SSE event if response hasn't started
      if (!response.headersSent) {
        response.setHeader('Content-Type', 'text/event-stream');
        const errorEvent = `data: ${JSON.stringify({
          id: requestId,
          type: 'abort',
          error: httpError.message,
          close: true,
        })}\n\n`;
        response.write(errorEvent);
        response.end();
      } else {
        // If headers already sent, just end the response
        response.end();
      }
    }
  }
}
