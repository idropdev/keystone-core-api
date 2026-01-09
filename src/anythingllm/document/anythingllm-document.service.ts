import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  AnythingLLMRegistryClient,
  RegistryCallResult,
} from '../registry/anythingllm-registry-client';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';
import {
  DocumentUploadResponseSchema,
  UploadLinkRequestSchema,
  UploadRawTextRequestSchema,
  ListDocumentsResponseSchema,
  GetDocumentResponseSchema,
  AcceptedFileTypesResponseSchema,
  MetadataSchemaResponseSchema,
  CreateFolderResponseSchema,
  RemoveFolderResponseSchema,
  MoveFilesRequestSchema,
  MoveFilesResponseSchema,
} from '../registry/schemas';
import { UpstreamError } from '../registry/upstream-error';
import { RequesterContextDto } from '../../anythingllm-orchestrator/dto/call-anythingllm.dto';

/**
 * AnythingLLM Document Service
 *
 * Provides typed methods for all AnythingLLM document operations.
 * Handles file uploads, document management, and folder operations.
 *
 * HIPAA Compliance: Never logs tokens or sensitive authentication data.
 */
@Injectable()
export class AnythingLLMDocumentService {
  private readonly logger = new Logger(AnythingLLMDocumentService.name);

  constructor(
    private readonly registryClient: AnythingLLMRegistryClient,
    private readonly clientService: AnythingLLMClientService,
    private readonly orchestratorService: AnythingLLMOrchestratorService,
  ) {}

  /**
   * Upload document to AnythingLLM with multipart form data
   * Supports delegated token (user JWT) or service identity authentication
   *
   * @param file - File buffer
   * @param fileName - Original filename
   * @param addToWorkspaces - Comma-separated workspace slugs (optional)
   * @param externalOCRFields - JSON string of OCR fields (optional, validated but not parsed)
   * @param requesterContext - User context if JWT present (optional)
   * @returns Upstream response from AnythingLLM
   */
  async uploadDocument(
    file: Buffer,
    fileName: string,
    addToWorkspaces?: string,
    externalOCRFields?: string,
    requesterContext?: RequesterContextDto,
  ): Promise<Response> {
    // Validate externalOCRFields if provided
    if (externalOCRFields !== undefined && externalOCRFields !== null) {
      if (typeof externalOCRFields !== 'string') {
        throw new BadRequestException(
          'externalOCRFields must be a JSON string',
        );
      }

      try {
        const parsed = JSON.parse(externalOCRFields);
        // Validate it's an array (structure only, don't inspect contents)
        if (!Array.isArray(parsed)) {
          throw new BadRequestException(
            'externalOCRFields must be a JSON array',
          );
        }
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        throw new BadRequestException('externalOCRFields must be valid JSON');
      }
    }

    // Create FormData for file upload
    // Node.js 18+ has native FormData support (compatible with fetch)
    // Use global FormData and convert Buffer to Blob for compatibility
    const FormDataClass = globalThis.FormData;
    if (!FormDataClass) {
      throw new Error('FormData is not available. Node.js 18+ is required.');
    }

    const formData = new FormDataClass();
    if (Buffer.isBuffer(file)) {
      // Convert Buffer to Blob for FormData (Node.js 18+ global FormData requires Blob)
      const uint8Array = new Uint8Array(file);
      const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
      formData.append('file', blob, fileName);
    } else {
      formData.append('file', file as any, fileName);
    }

    // Add optional form fields
    if (addToWorkspaces) {
      formData.append('addToWorkspaces', addToWorkspaces);
    }
    if (externalOCRFields) {
      formData.append('externalOCRFields', externalOCRFields);
    }

    const path = '/v1/document/upload';

    // Route based on authentication type
    if (requesterContext) {
      // User JWT present → use orchestrator (policy check + delegated token)
      return this.orchestratorService.executeOperation({
        operation: AnythingLLMOperation.DOCUMENT_UPLOAD,
        requesterContext,
        endpoint: path,
        method: 'POST',
        body: formData,
      });
    } else {
      // Service identity → call client directly (bypass policy)
      return this.clientService.callAnythingLLM(path, {
        method: 'POST',
        body: formData,
        headers: {
          // Don't set Content-Type - FormData will set it with boundary
        },
      });
    }
  }

  /**
   * Upload a file to AnythingLLM
   * Uses FormData for multipart file upload
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async uploadFile(
    file: File | Buffer,
    fileName: string,
    folderName?: string,
  ): Promise<RegistryCallResult<DocumentUploadResponseSchema>> {
    // TODO: Non-admin endpoints have been temporarily disabled
    // const endpointId = folderName
    //   ? AnythingLLMAdminEndpointIds.UPLOAD_DOCUMENT_TO_FOLDER
    //   : AnythingLLMAdminEndpointIds.UPLOAD_DOCUMENT;

    const path = folderName
      ? `/v1/document/upload/${encodeURIComponent(folderName)}`
      : '/v1/document/upload';

    // Create FormData for file upload
    // Node.js 18+ has native FormData support (compatible with fetch)
    // Use global FormData and convert Buffer to Blob for compatibility
    const FormDataClass = globalThis.FormData;
    if (!FormDataClass) {
      throw new Error('FormData is not available. Node.js 18+ is required.');
    }

    const formData = new FormDataClass();
    if (file instanceof File) {
      formData.append('file', file);
    } else if (Buffer.isBuffer(file)) {
      // Convert Buffer to Blob for FormData (Node.js 18+ global FormData requires Blob)
      const uint8Array = new Uint8Array(file);
      const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
      formData.append('file', blob, fileName);
    } else {
      // Fallback for other types
      formData.append('file', file as any, fileName);
    }

    try {
      const response = await this.clientService.callAnythingLLM(path, {
        method: 'POST',
        body: formData,
        headers: {
          // Don't set Content-Type - browser will set it with boundary
        },
      });

      if (!response.ok) {
        throw await UpstreamError.fromResponse(response, 'upload-file', path, {
          fileName,
          folderName,
        });
      }

      const data = (await response.json()) as DocumentUploadResponseSchema;

      return {
        data,
        requestId: 'upload-file',
        status: response.status,
      };
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw error;
      }
      throw UpstreamError.fromNetworkError(
        error instanceof Error ? error : new Error(String(error)),
        'upload-file',
        path,
        { fileName, folderName },
      );
    }
  }

  /**
   * Upload a URL for AnythingLLM to scrape
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async uploadLink(
    request: UploadLinkRequestSchema,
  ): Promise<RegistryCallResult<DocumentUploadResponseSchema>> {
    throw new Error(
      'Non-admin document endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<
    //   DocumentUploadResponseSchema,
    //   UploadLinkRequestSchema
    // >(AnythingLLMAdminEndpointIds.UPLOAD_DOCUMENT_LINK, { body: request });
  }

  /**
   * Upload raw text (e.g., from OCR pipeline)
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async uploadRawText(
    request: UploadRawTextRequestSchema,
    folderName?: string,
  ): Promise<RegistryCallResult<DocumentUploadResponseSchema>> {
    throw new Error(
      'Non-admin document endpoints have been temporarily disabled',
    );
    // const endpointId = AnythingLLMAdminEndpointIds.UPLOAD_DOCUMENT_RAW_TEXT;
    // return this.registryClient.call<
    //   DocumentUploadResponseSchema,
    //   UploadRawTextRequestSchema
    // >(endpointId, { body: request });
  }

  /**
   * List all documents (instance-wide)
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async listDocuments(): Promise<
    RegistryCallResult<ListDocumentsResponseSchema>
  > {
    throw new Error(
      'Non-admin document endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<ListDocumentsResponseSchema>(
    //   AnythingLLMAdminEndpointIds.LIST_DOCUMENTS,
    // );
  }

  /**
   * List documents in a specific folder
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async listDocumentsInFolder(
    folderName: string,
  ): Promise<RegistryCallResult<ListDocumentsResponseSchema>> {
    throw new Error(
      'Non-admin document endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<ListDocumentsResponseSchema>(
    //   AnythingLLMAdminEndpointIds.LIST_DOCUMENTS_FOLDER,
    //   { params: { folderName } },
    // );
  }

  /**
   * Get single document by name
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async getDocument(
    docName: string,
  ): Promise<RegistryCallResult<GetDocumentResponseSchema>> {
    throw new Error(
      'Non-admin document endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<GetDocumentResponseSchema>(
    //   AnythingLLMAdminEndpointIds.GET_DOCUMENT,
    //   { params: { docName } },
    // );
  }

  /**
   * Get accepted file types
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async getAcceptedFileTypes(): Promise<
    RegistryCallResult<AcceptedFileTypesResponseSchema>
  > {
    throw new Error(
      'Non-admin document endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<AcceptedFileTypesResponseSchema>(
    //   AnythingLLMAdminEndpointIds.GET_ACCEPTED_FILE_TYPES,
    // );
  }

  /**
   * Get metadata schema for raw-text uploads
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async getMetadataSchema(): Promise<
    RegistryCallResult<MetadataSchemaResponseSchema>
  > {
    throw new Error(
      'Non-admin document endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<MetadataSchemaResponseSchema>(
    //   AnythingLLMAdminEndpointIds.GET_METADATA_SCHEMA,
    // );
  }

  /**
   * Create a document folder
   */
  async createFolder(
    folderName: string,
  ): Promise<RegistryCallResult<CreateFolderResponseSchema>> {
    // Create folder uses FormData with folderName
    const FormDataClass = globalThis.FormData || require('form-data');
    const formData = new FormDataClass();
    formData.append('folderName', folderName);

    const path = '/v1/document/create-folder';
    try {
      const response = await this.clientService.callAnythingLLM(path, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw await UpstreamError.fromResponse(
          response,
          'create-folder',
          path,
          { folderName },
        );
      }

      const data = (await response.json()) as CreateFolderResponseSchema;

      return {
        data,
        requestId: 'create-folder',
        status: response.status,
      };
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw error;
      }
      throw UpstreamError.fromNetworkError(
        error instanceof Error ? error : new Error(String(error)),
        'create-folder',
        path,
        { folderName },
      );
    }
  }

  /**
   * Remove a document folder
   */
  async removeFolder(
    folderName: string,
  ): Promise<RegistryCallResult<RemoveFolderResponseSchema>> {
    // Remove folder uses FormData with folderName
    const FormDataClass = globalThis.FormData || require('form-data');
    const formData = new FormDataClass();
    formData.append('folderName', folderName);

    const path = '/v1/document/remove-folder';
    try {
      const response = await this.clientService.callAnythingLLM(path, {
        method: 'DELETE',
        body: formData,
      });

      if (!response.ok) {
        throw await UpstreamError.fromResponse(
          response,
          'remove-folder',
          path,
          { folderName },
        );
      }

      const data = (await response.json()) as RemoveFolderResponseSchema;

      return {
        data,
        requestId: 'remove-folder',
        status: response.status,
      };
    } catch (error) {
      if (error instanceof UpstreamError) {
        throw error;
      }
      throw UpstreamError.fromNetworkError(
        error instanceof Error ? error : new Error(String(error)),
        'remove-folder',
        path,
        { folderName },
      );
    }
  }

  /**
   * Move files between folders
   * TODO: Non-admin endpoints have been temporarily disabled
   */
  async moveFiles(
    request: MoveFilesRequestSchema,
  ): Promise<RegistryCallResult<MoveFilesResponseSchema>> {
    throw new Error(
      'Non-admin document endpoints have been temporarily disabled',
    );
    // return this.registryClient.call<
    //   MoveFilesResponseSchema,
    //   MoveFilesRequestSchema
    // >(AnythingLLMAdminEndpointIds.MOVE_FILES, { body: request });
  }
}
