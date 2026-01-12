import {
  Controller,
  Get,
  Request,
  UseGuards,
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
import { AuthGuard } from '@nestjs/passport';
import { Response, Request as ExpressRequest } from 'express';
import { AnythingLLMSystemService } from './anythingllm-system.service';
import { UpstreamError } from '../registry/upstream-error';
import {
  AuthCheckResponseSchema,
  CheckTokenResponseSchema,
  SystemInfoResponseSchema,
  VectorCountResponseSchema,
  WorkspaceCountResponseSchema,
  DocumentCountResponseSchema,
} from '../registry/schemas';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';
import { RoleEnum } from '../../roles/roles.enum';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { randomUUID } from 'crypto';

/**
 * AnythingLLM System Controller
 *
 * User-facing controller for system endpoints requiring JWT authentication.
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
 * - Auth responses normalized (no raw AnythingLLM messages)
 */
@ApiTags('AnythingLLM System')
@Controller('anythingllm/v1/system')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AnythingLLMSystemController {
  private readonly logger = new Logger(AnythingLLMSystemController.name);

  constructor(private readonly systemService: AnythingLLMSystemService) {}

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
   */
  private logEndpointCall(
    endpoint: string,
    operation: AnythingLLMOperation,
    request: ExpressRequest & { user?: JwtPayloadType },
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
        component: 'anythingllm-system',
        event: 'SYSTEM_ENDPOINT_CALL',
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

  // ============================================================
  // Auth Endpoints (Hybrid)
  // ============================================================

  @Get('auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check AnythingLLM authentication' })
  @ApiResponse({
    status: 200,
    description: 'Authentication status',
    type: AuthCheckResponseSchema,
  })
  async checkAuth(
    @Request() request: ExpressRequest & { user?: JwtPayloadType },
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthCheckResponseSchema> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      const result = await this.systemService.checkAuth(requesterContext);

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/auth',
        AnythingLLMOperation.SYSTEM_AUTH_CHECK,
        request,
        result.status,
        durationMs,
        requestId,
      );

      return result.data;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorStatus =
        error instanceof HttpException ? error.getStatus() : 500;
      this.logEndpointCall(
        '/v1/auth',
        AnythingLLMOperation.SYSTEM_AUTH_CHECK,
        request,
        errorStatus,
        durationMs,
        requestId,
      );
      throw this.handleError(error);
    }
  }

  @Get('check-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check token validity' })
  @ApiResponse({
    status: 200,
    description: 'Token validity status',
    type: CheckTokenResponseSchema,
  })
  async checkToken(
    @Request() request: ExpressRequest & { user?: JwtPayloadType },
    @Res({ passthrough: true }) response: Response,
  ): Promise<CheckTokenResponseSchema> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      const result = await this.systemService.checkToken(requesterContext);

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system/check-token',
        AnythingLLMOperation.SYSTEM_AUTH_CHECK,
        request,
        result.status,
        durationMs,
        requestId,
      );

      return result.data;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system/check-token',
        AnythingLLMOperation.SYSTEM_AUTH_CHECK,
        request,
        error instanceof HttpException ? error.getStatus() : 500,
        durationMs,
        requestId,
      );
      throw this.handleError(error);
    }
  }

  // ============================================================
  // System Info Endpoints (Delegated Preferred)
  // ============================================================

  @Get('')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get system information' })
  @ApiResponse({
    status: 200,
    description: 'System information',
    type: SystemInfoResponseSchema,
  })
  async getSystemInfo(
    @Request() request: ExpressRequest & { user?: JwtPayloadType },
    @Res({ passthrough: true }) response: Response,
  ): Promise<SystemInfoResponseSchema> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      const result = await this.systemService.getSystemInfo(requesterContext);

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system',
        AnythingLLMOperation.SYSTEM_READ,
        request,
        result.status,
        durationMs,
        requestId,
      );

      return result.data;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system',
        AnythingLLMOperation.SYSTEM_READ,
        request,
        error instanceof HttpException ? error.getStatus() : 500,
        durationMs,
        requestId,
      );
      throw this.handleError(error);
    }
  }

  @Get('vector-count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get vector count',
    description: 'Number of all vectors in connected vector database',
  })
  @ApiResponse({
    status: 200,
    description: 'OK',
    type: VectorCountResponseSchema,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 500, description: 'Internal Server Error' })
  async getVectorCount(
    @Request() request: ExpressRequest & { user?: JwtPayloadType },
    @Res({ passthrough: true }) response: Response,
  ): Promise<VectorCountResponseSchema> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      const result = await this.systemService.getVectorCount(requesterContext);

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system/vector-count',
        AnythingLLMOperation.VECTOR_COUNT_READ,
        request,
        result.status,
        durationMs,
        requestId,
      );

      return result.data;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system/vector-count',
        AnythingLLMOperation.VECTOR_COUNT_READ,
        request,
        error instanceof HttpException ? error.getStatus() : 500,
        durationMs,
        requestId,
      );
      throw this.handleError(error);
    }
  }

  @Get('workspace-count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get workspace count' })
  @ApiResponse({
    status: 200,
    description: 'Workspace count',
    type: WorkspaceCountResponseSchema,
  })
  async getWorkspaceCount(
    @Request() request: ExpressRequest & { user?: JwtPayloadType },
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkspaceCountResponseSchema> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      const result =
        await this.systemService.getWorkspaceCount(requesterContext);

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system/workspace-count',
        AnythingLLMOperation.WORKSPACE_COUNT_READ,
        request,
        result.status,
        durationMs,
        requestId,
      );

      return result.data;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system/workspace-count',
        AnythingLLMOperation.WORKSPACE_COUNT_READ,
        request,
        error instanceof HttpException ? error.getStatus() : 500,
        durationMs,
        requestId,
      );
      throw this.handleError(error);
    }
  }

  @Get('document-count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get document count' })
  @ApiResponse({
    status: 200,
    description: 'Document count',
    type: DocumentCountResponseSchema,
  })
  async getDocumentCount(
    @Request() request: ExpressRequest & { user?: JwtPayloadType },
    @Res({ passthrough: true }) response: Response,
  ): Promise<DocumentCountResponseSchema> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      const result =
        await this.systemService.getDocumentCount(requesterContext);

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system/document-count',
        AnythingLLMOperation.DOCUMENT_COUNT_READ,
        request,
        result.status,
        durationMs,
        requestId,
      );

      return result.data;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/system/document-count',
        AnythingLLMOperation.DOCUMENT_COUNT_READ,
        request,
        error instanceof HttpException ? error.getStatus() : 500,
        durationMs,
        requestId,
      );
      throw this.handleError(error);
    }
  }

  // ============================================================
  // Error Handling
  // ============================================================

  /**
   * Convert UpstreamError to HttpException
   */
  private handleError(error: unknown): HttpException {
    if (error instanceof UpstreamError) {
      return new HttpException(error.toJSON(), error.status);
    }

    if (error instanceof HttpException) {
      return error;
    }

    this.logger.error(
      `Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`,
    );

    return new HttpException(
      {
        error: 'InternalError',
        message: 'An unexpected error occurred',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
