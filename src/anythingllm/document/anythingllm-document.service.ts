import { Injectable, Logger } from '@nestjs/common';
import {
  AnythingLLMRegistryClient,
  RegistryCallResult,
} from '../registry/anythingllm-registry-client';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';
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
  ) {}

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
    // Prefer form-data package in Node.js (accepts Buffer natively)
    // Fall back to globalThis.FormData (browser-compatible, requires Blob)
    let FormDataClass: any;
    let isBrowserFormData = false;
    try {
      // Try to use form-data package first (Node.js native, accepts Buffer)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      FormDataClass = require('form-data');
      // Verify it's actually the form-data package (has getHeaders method)
      if (!FormDataClass.prototype.getHeaders) {
        throw new Error('Invalid form-data package');
      }
    } catch {
      // Fall back to globalThis.FormData (browser-compatible)
      FormDataClass = globalThis.FormData;
      isBrowserFormData = true;
    }

    const formData = new FormDataClass();
    if (file instanceof File) {
      formData.append('file', file);
    } else if (Buffer.isBuffer(file)) {
      if (isBrowserFormData) {
        // Browser FormData: convert Buffer to Blob
        // Convert Buffer to Uint8Array (which is a valid BlobPart)
        const uint8Array = new Uint8Array(file);
        const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
        formData.append('file', blob, fileName);
      } else {
        // form-data package: accepts Buffer directly
        formData.append('file', file, fileName);
      }
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
        throw await UpstreamError.fromResponse(
          response,
          'upload-file',
          path,
          { fileName, folderName },
        );
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
    throw new Error('Non-admin document endpoints have been temporarily disabled');
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
    throw new Error('Non-admin document endpoints have been temporarily disabled');
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
    throw new Error('Non-admin document endpoints have been temporarily disabled');
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
    throw new Error('Non-admin document endpoints have been temporarily disabled');
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
    throw new Error('Non-admin document endpoints have been temporarily disabled');
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
    throw new Error('Non-admin document endpoints have been temporarily disabled');
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
    throw new Error('Non-admin document endpoints have been temporarily disabled');
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
    throw new Error('Non-admin document endpoints have been temporarily disabled');
    // return this.registryClient.call<
    //   MoveFilesResponseSchema,
    //   MoveFilesRequestSchema
    // >(AnythingLLMAdminEndpointIds.MOVE_FILES, { body: request });
  }
}

