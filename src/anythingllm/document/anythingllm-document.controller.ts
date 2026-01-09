import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Request,
  HttpCode,
  HttpStatus,
  HttpException,
  BadRequestException,
  Logger,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Response, Request as ExpressRequest } from 'express';
import { OptionalJwtGuard } from '../guards/optional-jwt.guard';
import { AnythingLLMDocumentService } from './anythingllm-document.service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';
import { RoleEnum } from '../../roles/roles.enum';
import { JwtPayloadType } from '../../auth/strategies/types/jwt-payload.type';
import { DocumentUploadResponseDto } from './dto/document-upload-response.dto';
import { DocumentUploadRequestDto } from './dto/document-upload-request.dto';
import { DocumentUploadResponseSchema } from '../registry/schemas';
import { randomUUID } from 'crypto';

type ExpressRequestWithUser = ExpressRequest & { user?: JwtPayloadType };

/**
 * AnythingLLM Document Controller
 *
 * User-facing controller for document upload endpoints with optional JWT authentication.
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
 * - Never logs tokens, file names, file contents, or OCR values
 * - All errors are normalized to prevent information leakage
 * - Response sanitization removes infrastructure-revealing fields
 */
@ApiTags('AnythingLLM Document')
@Controller('anythingllm/v1/document')
@UseGuards(OptionalJwtGuard)
@ApiBearerAuth()
export class AnythingLLMDocumentController {
  private readonly logger = new Logger(AnythingLLMDocumentController.name);

  constructor(private readonly documentService: AnythingLLMDocumentService) {}

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
   * Sanitize document upload response
   * Removes infrastructure-revealing fields (location, url, name) for HIPAA compliance
   */
  private sanitizeDocumentUploadResponse(
    upstreamResponse: DocumentUploadResponseSchema,
  ): DocumentUploadResponseDto {
    return {
      success: upstreamResponse.success,
      error: upstreamResponse.error ?? undefined,
      documents: upstreamResponse.documents?.map((doc) => ({
        title: doc.title,
        wordCount: doc.wordCount,
        token_count_estimate: doc.token_count_estimate,
      })),
    };
  }

  /**
   * Log endpoint call for audit trail
   * HIPAA-compliant: Never logs file names, file contents, OCR values, workspace names, or paths
   */
  private logEndpointCall(
    endpoint: string,
    operation: AnythingLLMOperation,
    request: ExpressRequestWithUser,
    statusCode: number,
    durationMs: number,
    requestId: string,
    workspaceTargetsCount?: number,
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
        component: 'anythingllm-document',
        event: 'DOCUMENT_UPLOAD',
        endpoint,
        operation,
        userId,
        sessionId,
        actorType,
        roles,
        workspaceTargets: workspaceTargetsCount ?? 0,
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
          'Document processing failed',
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

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload document to AnythingLLM',
    description:
      'Upload a document file to AnythingLLM for processing and embedding. Supports multipart/form-data with file, optional workspace targets, and optional OCR fields.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'File to upload for processing',
        },
        addToWorkspaces: {
          type: 'string',
          description: 'Comma-separated workspace slugs to embed document into',
          example: 'workspace1,workspace2',
        },
        externalOCRFields: {
          type: 'string',
          description: 'JSON array string of OCR fields from Google OCR',
          example:
            '[{"fieldKey":"lab_test_value","fieldValue":"6.3 x10^3/uL","fieldType":"lab_test_value","confidence":0.85}]',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Document uploaded successfully',
    type: DocumentUploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file or parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({
    status: 502,
    description: 'Bad Gateway - upstream processing failed',
  })
  @ApiResponse({ status: 503, description: 'Service Unavailable' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 100 * 1024 * 1024, // 100 MB
        files: 1,
      },
    }),
  )
  async uploadDocument(
    @Request() request: ExpressRequestWithUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: DocumentUploadRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DocumentUploadResponseDto> {
    const startTime = Date.now();
    const requestId = randomUUID();
    response.setHeader('X-Request-Id', requestId);

    try {
      // Validate file is present
      if (!file) {
        throw new BadRequestException('File is required');
      }

      // Extract form fields from request.body (multipart form data)
      // NestJS FileInterceptor with multer should populate request.body with form fields
      // But @Body() may not work for multipart, so check request.body first
      const formData =
        request.body && Object.keys(request.body).length > 0
          ? request.body
          : body;
      const addToWorkspaces = formData?.addToWorkspaces;
      const externalOCRFields = formData?.externalOCRFields;

      // Validate workspace is required
      if (!addToWorkspaces) {
        throw new BadRequestException(
          'At least one workspace must be specified in addToWorkspaces',
        );
      }

      // Extract requester context if user JWT is present
      const requesterContext = request.user
        ? this.mapUserToRequesterContext(request.user)
        : undefined;

      // Count workspace targets (for audit logging only)
      const workspaceTargetsCount = addToWorkspaces
        ? addToWorkspaces.split(',').length
        : 0;

      // Call service to upload document
      const upstreamResponse = await this.documentService.uploadDocument(
        file.buffer,
        file.originalname,
        addToWorkspaces,
        externalOCRFields,
        requesterContext,
      );

      // Parse upstream response
      let upstreamData: DocumentUploadResponseSchema;
      if (!upstreamResponse.ok) {
        // Handle error responses
        const errorText = await upstreamResponse.text();

        try {
          upstreamData = JSON.parse(errorText) as DocumentUploadResponseSchema;
        } catch {
          // If not JSON, create error response
          upstreamData = {
            success: false,
            error: 'Document processing failed',
            documents: undefined,
          };
        }

        const durationMs = Date.now() - startTime;
        this.logEndpointCall(
          '/v1/document/upload',
          AnythingLLMOperation.DOCUMENT_UPLOAD,
          request,
          upstreamResponse.status,
          durationMs,
          requestId,
          workspaceTargetsCount,
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
            'Document processing failed',
            HttpStatus.BAD_GATEWAY,
          );
        }
        throw new HttpException(
          'Document processing failed',
          HttpStatus.BAD_GATEWAY,
        );
      }

      // Parse successful response
      upstreamData =
        (await upstreamResponse.json()) as DocumentUploadResponseSchema;

      // Sanitize response (remove infrastructure-revealing fields)
      const sanitized = this.sanitizeDocumentUploadResponse(upstreamData);

      const durationMs = Date.now() - startTime;
      this.logEndpointCall(
        '/v1/document/upload',
        AnythingLLMOperation.DOCUMENT_UPLOAD,
        request,
        upstreamResponse.status,
        durationMs,
        requestId,
        workspaceTargetsCount,
      );

      return sanitized;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const httpError = this.handleError(error);

      // Log error (HIPAA-compliant, no file names or contents)
      this.logEndpointCall(
        '/v1/document/upload',
        AnythingLLMOperation.DOCUMENT_UPLOAD,
        request,
        httpError.getStatus(),
        durationMs,
        requestId,
      );

      throw httpError;
    }
  }
}
