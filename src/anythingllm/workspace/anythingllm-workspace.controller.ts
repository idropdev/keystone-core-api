import {
  Controller,
  Post,
  UseGuards,
  Body,
  Request,
  HttpCode,
  HttpStatus,
  HttpException,
  Logger,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Response, Request as ExpressRequest } from 'express';
import { OptionalJwtGuard } from '../guards/optional-jwt.guard';
import { AnythingLLMWorkspaceService } from './anythingllm-workspace.service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { RoleEnum } from '../../roles/roles.enum';
import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';
import {
  CreateWorkspaceRequestSchema,
  CreateWorkspaceResponseSchema,
} from '../registry/schemas';
import { randomUUID } from 'crypto';

type ExpressRequestWithUser = ExpressRequest & { user?: JwtPayloadType };

/**
 * AnythingLLM Workspace Controller
 *
 * User-facing controller for workspace endpoints with optional JWT authentication.
 *
 * Authentication Strategy:
 * - ALWAYS uses service-to-service authentication (Keystone → AnythingLLM)
 * - When user JWT is present (user/manager/admin):
 *   → Extracts user context (userId, roles) from JWT
 *   → Uses delegated token with service identity (sub: 'svc-keystone')
 *   → Embeds user context in act claim: { sub: userId, roles: ['admin'|'manager'|'user'] }
 * - When no user JWT:
 *   → Uses pure service identity (GCP OIDC token)
 *
 * HIPAA Compliance:
 * - Optional JWT guard allows both user and service identity
 * - Never logs tokens or sensitive authentication data
 * - All errors are normalized to prevent information leakage
 */
@ApiTags('AnythingLLM Workspace')
@Controller('anythingllm/v1/workspace')
@UseGuards(OptionalJwtGuard)
@ApiBearerAuth()
export class AnythingLLMWorkspaceController {
  private readonly logger = new Logger(AnythingLLMWorkspaceController.name);

  constructor(private readonly workspaceService: AnythingLLMWorkspaceService) {}

  /**
   * Map JWT payload to RequesterContextDto
   */
  private mapUserToRequesterContext(
    user: JwtPayloadType,
  ): RequesterContextDto {
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
        event: 'WORKSPACE_CREATE',
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
  @ApiResponse({ status: 502, description: 'Bad Gateway - upstream processing failed' })
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
      upstreamData = (await upstreamResponse.json()) as CreateWorkspaceResponseSchema;
      
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
}

