import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentProcessingDomainService } from './domain/services/document-processing.domain.service';
import { DocumentRepositoryPort } from './domain/ports/document.repository.port';
import { StorageServicePort } from './domain/ports/storage.service.port';
import { OcrServicePort } from './domain/ports/ocr.service.port';
import { AuditService } from '../audit/audit.service';
import { DocumentType } from './domain/enums/document-type.enum';
import { DocumentStatus } from './domain/enums/document-status.enum';
import { Pdf2JsonService } from './infrastructure/pdf-extraction/pdf2json.service';
import { OcrMergeService } from './utils/ocr-merge.service';
import { OcrPostProcessorService } from './utils/ocr-post-processor.service';
import { GeminiEntityExtractorService } from './infrastructure/extraction/gemini-entity-extractor.service';
import { AnythingLLMDocumentService } from '../anythingllm/document/anythingllm-document.service';
import { AnythingLLMWorkspaceProvisioningService } from '../anythingllm/workspace/anythingllm-workspace-provisioning.service';

describe('DocumentProcessingDomainService', () => {
  let service: DocumentProcessingDomainService;
  let mockRepository: jest.Mocked<DocumentRepositoryPort>;
  let mockStorage: jest.Mocked<StorageServicePort>;
  let mockOcr: jest.Mocked<OcrServicePort>;
  let mockAudit: jest.Mocked<AuditService>;
  let mockGeminiExtractor: jest.Mocked<GeminiEntityExtractorService>;
  let mockAnythingLLMDocumentService: { uploadDocument: jest.Mock };
  let mockWorkspaceProvisioning: { getWorkspaceSlug: jest.Mock };

  beforeEach(async () => {
    // Create mocks
    mockRepository = {
      save: jest.fn(),
      update: jest.fn(),
      updateStatus: jest.fn(),
      findById: jest.fn(),
      findByIdAndUserId: jest.fn(),
      findByUserId: jest.fn(),
      findExpired: jest.fn(),
      hardDelete: jest.fn(),
      saveExtractedFields: jest.fn(),
      findExtractedFieldsByDocumentId: jest.fn(),
    } as any;

    mockStorage = {
      storeRaw: jest.fn(),
      storeProcessed: jest.fn(),
      delete: jest.fn(),
      getSignedUrl: jest.fn(),
      readRaw: jest.fn(),
    } as any;

    mockOcr = {
      processDocument: jest.fn(),
    } as any;

    mockAudit = {
      logAuthEvent: jest.fn(),
    } as any;

    mockGeminiExtractor = {
      extractEntities: jest.fn().mockResolvedValue([]),
    } as any;

    mockAnythingLLMDocumentService = {
      uploadDocument: jest.fn().mockResolvedValue({}),
    };

    mockWorkspaceProvisioning = {
      getWorkspaceSlug: jest.fn().mockResolvedValue(null),
    };

    const mockConfig = {
      getOrThrow: jest.fn((key) => {
        if (key === 'documentProcessing.retentionYears') return 8;
        if (key === 'documentProcessing.syncMaxPages') return 15;
        return 'mock-value';
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentProcessingDomainService,
        { provide: 'DocumentRepositoryPort', useValue: mockRepository },
        { provide: 'StorageServicePort', useValue: mockStorage },
        { provide: 'OcrServicePort', useValue: mockOcr },
        { provide: 'VisionOcrServicePort', useValue: mockOcr },
        { provide: 'DocumentAiOcrServicePort', useValue: mockOcr },
        { provide: AuditService, useValue: mockAudit },
        { provide: ConfigService, useValue: mockConfig },
        {
          provide: Pdf2JsonService,
          useValue: {
            parseBuffer: jest.fn().mockResolvedValue({ chunks: [], meta: {} }),
          },
        },
        {
          provide: OcrMergeService,
          useValue: { mergeOcrResults: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: OcrPostProcessorService,
          useValue: { process: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: 'ManagerRepositoryPort',
          useValue: {
            findByUserId: jest
              .fn()
              .mockResolvedValue({ id: 999, verificationStatus: 'verified' }),
          },
        },
        {
          provide: GeminiEntityExtractorService,
          useValue: mockGeminiExtractor,
        },
        {
          provide: AnythingLLMDocumentService,
          useValue: mockAnythingLLMDocumentService,
        },
        {
          provide: AnythingLLMWorkspaceProvisioningService,
          useValue: mockWorkspaceProvisioning,
        },
      ],
    }).compile();

    service = module.get<DocumentProcessingDomainService>(
      DocumentProcessingDomainService,
    );
  });

  describe('uploadDocument', () => {
    it('should upload document and trigger processing', async () => {
      const userId = 'user-123';
      const actor = { sub: userId, id: userId, type: 'user' } as any;
      const fileBuffer = Buffer.from('test file content');
      const fileName = 'test.pdf';
      const mimeType = 'application/pdf';
      const documentType = DocumentType.LAB_RESULT;

      mockRepository.save.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.UPLOADED,
        rawFileUri: '',
      } as any);

      mockStorage.storeRaw.mockResolvedValue(
        'gs://bucket/raw/user-123/doc-123_test.pdf',
      );

      // After upload, kickoffProcessing will look up the doc again with STORED status
      mockRepository.findById.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/user-123/doc-123_test.pdf',
        mimeType,
      } as any);

      // Don't let runProcessing actually run — spy it into a noop
      jest.spyOn(service as any, 'runProcessing').mockResolvedValue(undefined);

      await service.uploadDocument(
        actor,
        fileBuffer,
        fileName,
        mimeType,
        documentType,
      );

      expect(mockRepository.save).toHaveBeenCalled();
      expect(mockStorage.storeRaw).toHaveBeenCalledWith(
        fileBuffer,
        expect.objectContaining({
          userId,
          fileName,
          mimeType,
        }),
      );
      // First updateStatus: STORED (after GCS upload)
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'doc-123',
        DocumentStatus.STORED,
        expect.objectContaining({
          rawFileUri: expect.stringContaining('gs://'),
        }),
      );
      // Second updateStatus: PROCESSING (from kickoffProcessing)
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'doc-123',
        DocumentStatus.PROCESSING,
        expect.objectContaining({ processingStartedAt: expect.any(Date) }),
      );
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          event: expect.any(String),
          success: true,
        }),
      );
    });

    it('should never log PHI in audit events', async () => {
      const userId = 'user-123';
      const actor = { sub: userId, id: userId, type: 'user' } as any;
      const fileBuffer = Buffer.from('SENSITIVE PATIENT DATA');
      const fileName = 'patient_john_doe_results.pdf';

      mockRepository.save.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.UPLOADED,
      } as any);

      mockStorage.storeRaw.mockResolvedValue('gs://bucket/raw/file.pdf');

      mockRepository.findById.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/file.pdf',
        mimeType: 'application/pdf',
      } as any);
      jest.spyOn(service as any, 'runProcessing').mockResolvedValue(undefined);

      await service.uploadDocument(
        actor,
        fileBuffer,
        fileName,
        'application/pdf',
        DocumentType.LAB_RESULT,
      );

      // Verify audit log does NOT contain file content or GCS URI
      const auditCall = mockAudit.logAuthEvent.mock.calls[0][0];
      expect(JSON.stringify(auditCall)).not.toContain('SENSITIVE');
      expect(JSON.stringify(auditCall)).not.toContain('gs://');
      expect(JSON.stringify(auditCall)).not.toContain('patient_john_doe');
    });

    it('should roll back upload when kickoffProcessing fails', async () => {
      const userId = 'user-123';
      const actor = { sub: userId, id: userId, type: 'user' } as any;
      const fileBuffer = Buffer.from('test file content');
      const fileName = 'test.pdf';
      const mimeType = 'application/pdf';
      const documentType = DocumentType.LAB_RESULT;
      const gcsUri = 'gs://bucket/raw/user-123/doc-123_test.pdf';

      mockRepository.save.mockResolvedValue({
        id: 'doc-123',
        userId,
        status: DocumentStatus.UPLOADED,
        rawFileUri: '',
      } as any);
      mockStorage.storeRaw.mockResolvedValue(gcsUri);

      jest
        .spyOn(service as any, 'kickoffProcessing')
        .mockRejectedValue(new Error('Cloud SQL connection refused'));
      mockStorage.delete.mockResolvedValue(undefined);
      mockRepository.hardDelete.mockResolvedValue(undefined);

      await expect(
        service.uploadDocument(
          actor,
          fileBuffer,
          fileName,
          mimeType,
          documentType,
        ),
      ).rejects.toThrow(/Cloud SQL connection refused/);

      expect(mockStorage.delete).toHaveBeenCalledWith(gcsUri);
      expect(mockRepository.hardDelete).toHaveBeenCalledWith('doc-123');
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'DOCUMENT_DELETED',
          metadata: expect.objectContaining({
            documentId: 'doc-123',
            reason: 'auto-rollback-after-failed-ocr-kickoff',
          }),
        }),
      );
    });
  });

  describe('authorization', () => {
    it('should prevent unauthorized document access', async () => {
      mockRepository.findByIdAndUserId.mockResolvedValue(null);

      await expect(
        service.getDocument('doc-123', 'wrong-user'),
      ).rejects.toThrow();

      // Verify unauthorized access is logged
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          event: expect.stringContaining('UNAUTHORIZED'),
        }),
      );
    });

    it('should allow authorized document access', async () => {
      const mockDoc = {
        id: 'doc-123',
        userId: 'user-123',
        status: DocumentStatus.PROCESSED,
      };

      mockRepository.findByIdAndUserId.mockResolvedValue(mockDoc as any);

      const result = await service.getDocument('doc-123', 'user-123');

      expect(result).toEqual(mockDoc);
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          success: true,
          event: expect.stringContaining('ACCESSED'),
        }),
      );
    });
  });

  describe('cleanupExpiredDocuments', () => {
    it('should hard delete expired documents and audit log', async () => {
      const expiredDoc = {
        id: 'doc-old',
        userId: 'user-123',
        rawFileUri: 'gs://bucket/raw/file.pdf',
        processedFileUri: 'gs://bucket/processed/file.json',
        deletedAt: new Date('2017-01-01'),
        scheduledDeletionAt: new Date('2025-01-01'),
        documentType: DocumentType.LAB_RESULT,
      };

      mockRepository.findExpired.mockResolvedValue([expiredDoc] as any);
      mockStorage.delete.mockResolvedValue(undefined);
      mockRepository.hardDelete.mockResolvedValue(undefined);

      await service.cleanupExpiredDocuments();

      expect(mockStorage.delete).toHaveBeenCalledTimes(2); // raw + processed
      expect(mockRepository.hardDelete).toHaveBeenCalledWith('doc-old');
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          event: expect.stringContaining('HARD_DELETED'),
          success: true,
        }),
      );
    });

    it('should handle cleanup failures gracefully', async () => {
      const expiredDoc = {
        id: 'doc-old',
        userId: 'user-123',
        rawFileUri: 'gs://bucket/raw/file.pdf',
        deletedAt: new Date('2017-01-01'),
        scheduledDeletionAt: new Date('2025-01-01'),
        documentType: DocumentType.LAB_RESULT,
      };

      mockRepository.findExpired.mockResolvedValue([expiredDoc] as any);
      mockStorage.delete.mockRejectedValue(new Error('Storage error'));

      // Should not throw, but log error
      await expect(service.cleanupExpiredDocuments()).resolves.not.toThrow();

      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          event: expect.stringContaining('HARD_DELETED'),
        }),
      );
    });
  });

  describe('deleteDocument (soft delete)', () => {
    it('should soft delete document and schedule hard deletion', async () => {
      const mockDoc = {
        id: 'doc-123',
        userId: 'user-123',
        status: DocumentStatus.PROCESSED,
        deletedAt: null,
      };

      mockRepository.findByIdAndUserId.mockResolvedValue(mockDoc as any);
      mockRepository.update.mockResolvedValue(undefined);

      await service.deleteDocument('doc-123', 'user-123');

      expect(mockRepository.update).toHaveBeenCalledWith(
        'doc-123',
        expect.objectContaining({
          deletedAt: expect.any(Date),
          scheduledDeletionAt: expect.any(Date),
        }),
      );

      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          event: expect.stringContaining('DELETED'),
          success: true,
        }),
      );
    });

    it('should prevent double deletion', async () => {
      const mockDoc = {
        id: 'doc-123',
        userId: 'user-123',
        deletedAt: new Date(),
      };

      mockRepository.findByIdAndUserId.mockResolvedValue(mockDoc as any);

      await expect(
        service.deleteDocument('doc-123', 'user-123'),
      ).rejects.toThrow('already deleted');
    });
  });

  describe('getDownloadUrl', () => {
    it('should generate signed URL for authorized user', async () => {
      const mockDoc = {
        id: 'doc-123',
        userId: 'user-123',
        rawFileUri: 'gs://bucket/raw/file.pdf',
      };

      mockRepository.findByIdAndUserId.mockResolvedValue(mockDoc as any);
      mockStorage.getSignedUrl.mockResolvedValue(
        'https://storage.googleapis.com/signed-url',
      );

      const url = await service.getDownloadUrl('doc-123', 'user-123');

      expect(url).toContain('https://');
      expect(mockStorage.getSignedUrl).toHaveBeenCalledWith(
        'gs://bucket/raw/file.pdf',
        86400, // 24 hours
      );
    });

    it('should reject unauthorized download attempts', async () => {
      mockRepository.findByIdAndUserId.mockResolvedValue(null);

      await expect(
        service.getDownloadUrl('doc-123', 'wrong-user'),
      ).rejects.toThrow();

      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
        }),
      );
    });
  });

  describe('listDocuments', () => {
    it('should return paginated document list', async () => {
      const mockDocs = [
        { id: 'doc-1', userId: 'user-123', status: DocumentStatus.PROCESSED },
        { id: 'doc-2', userId: 'user-123', status: DocumentStatus.PROCESSING },
      ];

      mockRepository.findByUserId.mockResolvedValue({
        data: mockDocs as any,
        total: 2,
      });

      const result = await service.listDocuments('user-123', {
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should filter by status', async () => {
      mockRepository.findByUserId.mockResolvedValue({
        data: [],
        total: 0,
      });

      await service.listDocuments('user-123', {
        status: [DocumentStatus.PROCESSED],
      });

      expect(mockRepository.findByUserId).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          status: [DocumentStatus.PROCESSED],
        }),
      );
    });
  });

  describe('kickoffProcessing', () => {
    const docId = 'doc-kick-1';

    it('should validate state, set PROCESSING, and return the processing args', async () => {
      mockRepository.findById.mockResolvedValue({
        id: docId,
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/foo.pdf',
        mimeType: 'application/pdf',
      } as any);

      // Access the private method via bracket notation — TDD pragmatism
      const args = await (service as any).kickoffProcessing(docId);

      expect(mockRepository.findById).toHaveBeenCalledWith(docId);
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        docId,
        DocumentStatus.PROCESSING,
        expect.objectContaining({ processingStartedAt: expect.any(Date) }),
      );
      expect(args).toEqual({
        documentId: docId,
        gcsUri: 'gs://bucket/raw/foo.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('should throw NotFoundException when the document does not exist', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect((service as any).kickoffProcessing(docId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should propagate state-machine rejection without touching the DB', async () => {
      // ARCHIVED is a terminal state — ARCHIVED → PROCESSING is rejected by
      // validateTransition (no valid transitions from ARCHIVED). This confirms
      // kickoffProcessing propagates state-machine errors before updateStatus runs.
      mockRepository.findById.mockResolvedValue({
        id: docId,
        status: DocumentStatus.ARCHIVED,
        rawFileUri: 'gs://bucket/raw/foo.pdf',
        mimeType: 'application/pdf',
      } as any);

      await expect((service as any).kickoffProcessing(docId)).rejects.toThrow();
      expect(mockRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('should propagate DB updateStatus failures', async () => {
      mockRepository.findById.mockResolvedValue({
        id: docId,
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/foo.pdf',
        mimeType: 'application/pdf',
      } as any);
      mockRepository.updateStatus.mockRejectedValue(
        new Error('Cloud SQL connection refused'),
      );

      await expect((service as any).kickoffProcessing(docId)).rejects.toThrow(
        /Cloud SQL connection refused/,
      );
    });
  });

  describe('triggerOcr', () => {
    const docId = 'doc-trigger-1';
    const userId = 7;
    const actor = { id: userId, type: 'user' } as any;

    beforeEach(() => {
      mockRepository.findById.mockResolvedValue({
        id: docId,
        userId: String(userId),
        status: DocumentStatus.STORED,
        rawFileUri: 'gs://bucket/raw/x.pdf',
        mimeType: 'application/pdf',
        temporaryManagerId: userId,
      } as any);
    });

    it('should propagate sync kickoff failures instead of swallowing them', async () => {
      // Make the second findById (inside kickoffProcessing) fail
      mockRepository.findById
        .mockResolvedValueOnce({
          id: docId,
          userId: String(userId),
          status: DocumentStatus.STORED,
          rawFileUri: 'gs://bucket/raw/x.pdf',
          mimeType: 'application/pdf',
          temporaryManagerId: userId,
        } as any)
        .mockResolvedValueOnce(null);

      await expect(service.triggerOcr(docId, actor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should call kickoffProcessing then runProcessing on success', async () => {
      const kickoffSpy = jest
        .spyOn(service as any, 'kickoffProcessing')
        .mockResolvedValue({
          documentId: docId,
          gcsUri: 'gs://bucket/raw/x.pdf',
          mimeType: 'application/pdf',
        });
      const runSpy = jest
        .spyOn(service as any, 'runProcessing')
        .mockResolvedValue(undefined);

      await service.triggerOcr(docId, actor);

      expect(kickoffSpy).toHaveBeenCalledWith(docId);
      expect(runSpy).toHaveBeenCalledWith({
        documentId: docId,
        gcsUri: 'gs://bucket/raw/x.pdf',
        mimeType: 'application/pdf',
      });
    });
  });

  describe('pushToAnythingLLMWorkspace', () => {
    it('should push file + Document AI fields to user workspace on happy path', async () => {
      const doc = {
        id: 'doc-1',
        fileName: 'lab.pdf',
        rawFileUri: 'gs://bucket/raw/7/doc-1.pdf',
        temporaryManagerId: 7,
        originUserContextId: null,
        ocrJsonOutput: { entities: [{ type: 'PERSON', mentionText: 'John' }] },
      } as any;

      mockRepository.findById.mockResolvedValue(doc);
      mockWorkspaceProvisioning.getWorkspaceSlug.mockResolvedValue(
        'workspace-for-user-7',
      );
      mockStorage.readRaw.mockResolvedValue(Buffer.from('pdf-bytes'));
      mockAnythingLLMDocumentService.uploadDocument.mockResolvedValue({});

      await (service as any).pushToAnythingLLMWorkspace('doc-1');

      expect(mockWorkspaceProvisioning.getWorkspaceSlug).toHaveBeenCalledWith(
        '7',
      );
      expect(mockStorage.readRaw).toHaveBeenCalledWith(
        'gs://bucket/raw/7/doc-1.pdf',
      );
      expect(
        mockAnythingLLMDocumentService.uploadDocument,
      ).toHaveBeenCalledWith(
        expect.any(Buffer),
        'lab.pdf',
        'workspace-for-user-7',
        expect.stringContaining('entities'),
      );
    });

    it('should skip when document has no user context (manager upload without intake user)', async () => {
      const doc = {
        id: 'doc-2',
        fileName: 'mgr.pdf',
        temporaryManagerId: null,
        originUserContextId: null,
      } as any;

      mockRepository.findById.mockResolvedValue(doc);

      await (service as any).pushToAnythingLLMWorkspace('doc-2');

      expect(mockWorkspaceProvisioning.getWorkspaceSlug).not.toHaveBeenCalled();
      expect(
        mockAnythingLLMDocumentService.uploadDocument,
      ).not.toHaveBeenCalled();
    });

    it('should skip when no workspace mapped for user', async () => {
      const doc = {
        id: 'doc-3',
        fileName: 'foo.pdf',
        rawFileUri: 'gs://bucket/raw/5/doc-3.pdf',
        temporaryManagerId: 5,
      } as any;

      mockRepository.findById.mockResolvedValue(doc);
      mockWorkspaceProvisioning.getWorkspaceSlug.mockResolvedValue(null);

      await (service as any).pushToAnythingLLMWorkspace('doc-3');

      expect(
        mockAnythingLLMDocumentService.uploadDocument,
      ).not.toHaveBeenCalled();
    });

    it('should use originUserContextId when temporaryManagerId is null (manager upload with intake user)', async () => {
      const doc = {
        id: 'doc-4',
        fileName: 'intake.pdf',
        rawFileUri: 'gs://bucket/raw/9/doc-4.pdf',
        temporaryManagerId: null,
        originUserContextId: 9,
        ocrJsonOutput: null,
      } as any;

      mockRepository.findById.mockResolvedValue(doc);
      mockWorkspaceProvisioning.getWorkspaceSlug.mockResolvedValue(
        'workspace-for-user-9',
      );
      mockStorage.readRaw.mockResolvedValue(Buffer.from('pdf'));
      mockAnythingLLMDocumentService.uploadDocument.mockResolvedValue({});

      await (service as any).pushToAnythingLLMWorkspace('doc-4');

      expect(mockWorkspaceProvisioning.getWorkspaceSlug).toHaveBeenCalledWith(
        '9',
      );
    });

    it('should omit documentFields when ocrJsonOutput is null', async () => {
      const doc = {
        id: 'doc-5',
        fileName: 'no-ocr.pdf',
        rawFileUri: 'gs://bucket/raw/3/doc-5.pdf',
        temporaryManagerId: 3,
        ocrJsonOutput: null,
      } as any;

      mockRepository.findById.mockResolvedValue(doc);
      mockWorkspaceProvisioning.getWorkspaceSlug.mockResolvedValue(
        'workspace-for-user-3',
      );
      mockStorage.readRaw.mockResolvedValue(Buffer.from('pdf'));
      mockAnythingLLMDocumentService.uploadDocument.mockResolvedValue({});

      await (service as any).pushToAnythingLLMWorkspace('doc-5');

      expect(
        mockAnythingLLMDocumentService.uploadDocument,
      ).toHaveBeenCalledWith(
        expect.any(Buffer),
        'no-ocr.pdf',
        'workspace-for-user-3',
        undefined,
      );
    });
  });

  describe('runProcessing — AnythingLLM chat embed hook', () => {
    const processingArgs = {
      documentId: 'doc-99',
      gcsUri: 'gs://bucket/raw/doc-99.jpg',
      mimeType: 'image/jpeg', // non-PDF → skips pdf2json path
    };

    beforeEach(() => {
      // Both VisionOcrServicePort and DocumentAiOcrServicePort resolve to mockOcr;
      // return a minimal OCR result so the merge path has two successes to merge.
      mockOcr.processDocument.mockResolvedValue({
        text: 'lab results',
        confidence: 0.95,
        pageCount: 1,
        fullResponse: {},
      } as any);

      // mergeOcrResults already defaults to mockResolvedValue({}) from beforeEach;
      // storeProcessed needs an explicit URI.
      mockStorage.storeProcessed.mockResolvedValue(
        'gs://bucket/processed/doc-99.json',
      );

      // findById is called twice inside runProcessing:
      //   1. to load the document (needs userId, pageCount, status)
      //   2. for state-machine validation before PROCESSED transition
      mockRepository.findById.mockResolvedValue({
        id: 'doc-99',
        userId: 'user-99',
        status: DocumentStatus.PROCESSING,
        pageCount: 1,
      } as any);

      mockRepository.updateStatus.mockResolvedValue(undefined);

      // The outer beforeEach mockConfig only defines getOrThrow; runProcessing also
      // calls configService.get (no-throw variant) for feature flags. Patch it
      // directly on the service's injected configService instance so the non-PDF
      // OCR path can read ocrMerge.enabled and ocrPostProcessing.enabled.
      (service as any).configService.get = jest.fn().mockReturnValue(undefined);
    });

    it('should fire pushToAnythingLLMWorkspace once after successful OCR', async () => {
      const pushSpy = jest
        .spyOn(service as any, 'pushToAnythingLLMWorkspace')
        .mockResolvedValue(undefined);

      await (service as any).runProcessing(processingArgs);

      // Give the fire-and-forget microtask a turn to execute
      await new Promise((resolve) => setImmediate(resolve));

      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(pushSpy).toHaveBeenCalledWith('doc-99');
    });

    it('should not fail runProcessing if pushToAnythingLLMWorkspace throws', async () => {
      jest
        .spyOn(service as any, 'pushToAnythingLLMWorkspace')
        .mockRejectedValue(new Error('AnythingLLM down'));

      await expect(
        (service as any).runProcessing(processingArgs),
      ).resolves.toBeUndefined();
    });
  });

  describe('rollbackUpload', () => {
    const docId = 'doc-rollback-1';
    const gcsUri = 'gs://bucket/raw/foo.pdf';
    const reason = new Error('kickoff failed');

    it('should delete the GCS file, hard-delete the doc, and fire an audit event', async () => {
      mockStorage.delete.mockResolvedValue(undefined);
      mockRepository.hardDelete.mockResolvedValue(undefined);

      await (service as any).rollbackUpload(docId, gcsUri, reason);

      expect(mockStorage.delete).toHaveBeenCalledWith(gcsUri);
      expect(mockRepository.hardDelete).toHaveBeenCalledWith(docId);
      expect(mockAudit.logAuthEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'document-processing',
          success: true,
          metadata: expect.objectContaining({
            documentId: docId,
            reason: 'auto-rollback-after-failed-ocr-kickoff',
          }),
        }),
      );
    });

    it('should still hard-delete the doc when GCS delete fails', async () => {
      mockStorage.delete.mockRejectedValue(new Error('GCS network error'));
      mockRepository.hardDelete.mockResolvedValue(undefined);

      await (service as any).rollbackUpload(docId, gcsUri, reason);

      expect(mockStorage.delete).toHaveBeenCalled();
      expect(mockRepository.hardDelete).toHaveBeenCalledWith(docId);
    });

    it('should not throw even when both cleanup steps fail', async () => {
      mockStorage.delete.mockRejectedValue(new Error('GCS error'));
      mockRepository.hardDelete.mockRejectedValue(new Error('DB error'));

      await expect(
        (service as any).rollbackUpload(docId, gcsUri, reason),
      ).resolves.toBeUndefined();
    });
  });
});
