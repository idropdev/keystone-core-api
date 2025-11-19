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
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { DocumentProcessingService } from './document-processing.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { DocumentStatusResponseDto } from './dto/document-status-response.dto';
import { DocumentListQueryDto } from './dto/document-list-query.dto';
import { ExtractedFieldResponseDto } from './dto/extracted-field-response.dto';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';

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
  @ApiOperation({ summary: 'Get document processing status' })
  @ApiResponse({
    status: 200,
    description: 'Status retrieved',
    type: DocumentStatusResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDocumentStatus(
    @Request() req,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DocumentStatusResponseDto> {
    const userId = req.user.id;
    return this.documentProcessingService.getDocumentStatus(documentId, userId);
  }

  @Get(':documentId')
  @ApiOperation({ summary: 'Get document details and OCR results' })
  @ApiResponse({
    status: 200,
    description: 'Document retrieved',
    type: DocumentResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async getDocument(
    @Request() req,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<DocumentResponseDto> {
    const userId = req.user.id;
    const document = await this.documentProcessingService.getDocument(
      documentId,
      userId,
    );
    return this.documentProcessingService.toResponseDto(document);
  }

  @Get(':documentId/fields')
  @ApiOperation({ summary: 'Get extracted structured fields from document' })
  @ApiResponse({
    status: 200,
    description: 'Fields retrieved',
    type: [ExtractedFieldResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Document not found' })
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
  @ApiOperation({ summary: 'Get signed URL for document download' })
  @ApiResponse({
    status: 200,
    description: 'Download URL generated',
    schema: {
      properties: {
        downloadUrl: { type: 'string' },
        expiresIn: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Document not found' })
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
  @ApiOperation({ summary: 'List user documents with pagination' })
  @ApiResponse({ status: 200, description: 'Documents retrieved' })
  async listDocuments(
    @Request() req,
    @Query() query: DocumentListQueryDto,
  ): Promise<InfinityPaginationResponseDto<DocumentResponseDto>> {
    const userId = req.user.id;
    const result = await this.documentProcessingService.listDocuments(
      userId,
      query,
    );
    return result;
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Soft delete document (scheduled for hard delete after retention period)',
  })
  @ApiResponse({ status: 204, description: 'Document deleted' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  async deleteDocument(
    @Request() req,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    const userId = req.user.id;
    await this.documentProcessingService.deleteDocument(documentId, userId);
  }
}
