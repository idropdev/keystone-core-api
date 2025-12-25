import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiOkResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { DocumentProcessingService } from './document-processing.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentStatusResponseDto } from './dto/document-status-response.dto';
import { DocumentListQueryDto } from './dto/document-list-query.dto';
import { ExtractedFieldResponseDto } from './dto/extracted-field-response.dto';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { extractActorFromRequest } from './utils/actor-extractor.util';
import { RoleEnum } from '../roles/roles.enum';

/**
 * Document Processing Controller
 *
 * HIPAA Compliance:
 * - All endpoints protected by JWT authentication
 * - Session validation on every request (via existing JwtAuthGuard)
 * - Rate limiting to prevent abuse
 * - No PHI exposed in responses (only IDs and metadata)
 * - All access logged via AuditService
 *
 * Security:
 * - File validation (type, size)
 * - Authorization checks (users can only access their own documents)
 * - Sanitized error messages
 * - No internal URIs or paths exposed
 */
@ApiTags('Documents')
@Controller({ path: 'documents', version: '1' })
@UseGuards(AuthGuard('jwt')) // Existing JWT + session validation
@ApiBearerAuth()
export class DocumentProcessingController {
  constructor(
    private readonly documentProcessingService: DocumentProcessingService,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 uploads per minute
  @ApiOperation({ summary: 'Upload medical document for OCR processing' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Document file (PDF, JPEG, PNG)',
        },
        documentType: {
          type: 'string',
          enum: [
            'LAB_RESULT',
            'PRESCRIPTION',
            'MEDICAL_RECORD',
            'INSURANCE_CARD',
            'IMAGING_REPORT',
            'IMMUNIZATION_RECORD',
            'OTHER',
          ],
        },
        description: {
          type: 'string',
          maxLength: 500,
        },
      },
      required: ['file', 'documentType'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Document uploaded successfully',
    type: DocumentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file or parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB
        files: 1,
      },
      fileFilter: (req, file, callback) => {
        // Allowed MIME types for medical documents
        const allowedMimeTypes = [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/tiff',
          'image/gif',
        ];

        if (!allowedMimeTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException(
              `Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`,
            ),
            false,
          );
        }

        callback(null, true);
      },
    }),
  )
  async uploadDocument(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ): Promise<DocumentResponseDto> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const userId = req.user.id;

    const document = await this.documentProcessingService.uploadDocument(
      userId,
      file.buffer,
      file.originalname,
      file.mimetype,
      dto.documentType,
      dto.description,
    );

    return this.documentProcessingService.toResponseDto(document);
  }

  @Get(':documentId/status')
  @ApiOperation({
    summary: 'Get Document Processing Status',
    description:
      'Get the current processing status of a document. Returns status, progress percentage, and any error messages.',
  })
  @ApiParam({
    name: 'documentId',
    type: String,
    format: 'uuid',
    description: 'Document UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Document status retrieved',
    type: DocumentStatusResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiNotFoundResponse({
    description: 'Document not found or access denied',
  })
  async getDocumentStatus(
    @Request() req,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DocumentStatusResponseDto> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    return this.documentProcessingService.getDocumentStatus(documentId, actor);
  }

  @Get(':documentId')
  @ApiOperation({
    summary: 'Get Document Details',
    description:
      'Get detailed information about a document including metadata, processing status, and OCR results.',
  })
  @ApiParam({
    name: 'documentId',
    type: String,
    format: 'uuid',
    description: 'Document UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Document details retrieved',
    type: DocumentResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiNotFoundResponse({
    description: 'Document not found or access denied',
  })
  async getDocument(
    @Request() req,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DocumentResponseDto> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    const document = await this.documentProcessingService.getDocument(
      documentId,
      actor,
    );
    return this.documentProcessingService.toResponseDto(document);
  }

  @Get(':documentId/fields')
  @ApiOperation({
    summary: 'Get Extracted Fields',
    description:
      'Get structured fields extracted from the document via OCR processing (e.g., patient name, date, lab values).',
  })
  @ApiParam({
    name: 'documentId',
    type: String,
    format: 'uuid',
    description: 'Document UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Extracted fields retrieved',
    type: [ExtractedFieldResponseDto],
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiNotFoundResponse({
    description: 'Document not found or access denied',
  })
  async getExtractedFields(
    @Request() req,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<ExtractedFieldResponseDto[]> {
    const userId = req.user.id;
    return this.documentProcessingService.getExtractedFields(
      documentId,
      userId,
    );
  }

  @Get(':documentId/download')
  @ApiOperation({
    summary: 'Get Document Download URL',
    description:
      'Get a signed URL for downloading the original document file. The URL expires after 24 hours.',
  })
  @ApiParam({
    name: 'documentId',
    type: String,
    format: 'uuid',
    description: 'Document UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Download URL generated',
    schema: {
      type: 'object',
      properties: {
        downloadUrl: {
          type: 'string',
          example:
            'https://storage.googleapis.com/bucket/file.pdf?signature=...',
        },
        expiresIn: {
          type: 'number',
          example: 86400,
          description: 'Expiration in seconds (24 hours)',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiNotFoundResponse({
    description: 'Document not found or access denied',
  })
  async getDownloadUrl(
    @Request() req,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<{ downloadUrl: string; expiresIn: number }> {
    const userId = req.user.id;
    const downloadUrl = await this.documentProcessingService.getDownloadUrl(
      documentId,
      userId,
    );
    return { downloadUrl, expiresIn: 86400 }; // 24 hours
  }

  @Get()
  @ApiOperation({
    summary: 'List Documents',
    description:
      "Get a paginated list of the authenticated user's documents with optional filtering by status and document type.",
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10)',
    example: 10,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    description: 'Filter by processing status',
  })
  @ApiQuery({
    name: 'documentType',
    required: false,
    enum: [
      'LAB_RESULT',
      'PRESCRIPTION',
      'MEDICAL_RECORD',
      'INSURANCE_CARD',
      'IMAGING_REPORT',
      'IMMUNIZATION_RECORD',
      'OTHER',
    ],
    description: 'Filter by document type',
  })
  @ApiOkResponse({
    description: 'Paginated list of documents',
    type: InfinityPaginationResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  async listDocuments(
    @Request() req,
    @Query() query: DocumentListQueryDto,
  ): Promise<InfinityPaginationResponseDto<DocumentResponseDto>> {
    // Hard deny admins
    if (req.user?.role?.id === RoleEnum.admin) {
      throw new ForbiddenException('Admins do not have document-level access');
    }

    const actor = extractActorFromRequest(req);
    const result = await this.documentProcessingService.listDocuments(
      actor,
      query,
    );
    return result;
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete Document',
    description:
      'Soft delete a document. The document will be marked as deleted and scheduled for hard deletion after the retention period (8 years for HIPAA compliance).',
  })
  @ApiParam({
    name: 'documentId',
    type: String,
    format: 'uuid',
    description: 'Document UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiNoContentResponse({
    description: 'Document deleted successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired access token',
  })
  @ApiNotFoundResponse({
    description: 'Document not found or access denied',
  })
  async deleteDocument(
    @Request() req,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    const userId = req.user.id;
    await this.documentProcessingService.deleteDocument(documentId, userId);
  }
}
