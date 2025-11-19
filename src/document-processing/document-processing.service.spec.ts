import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentProcessingDomainService } from './domain/services/document-processing.domain.service';
import { DocumentRepositoryPort } from './domain/ports/document.repository.port';
import { StorageServicePort } from './domain/ports/storage.service.port';
import { OcrServicePort } from './domain/ports/ocr.service.port';
import { AuditService } from '../audit/audit.service';
import { DocumentType } from './domain/enums/document-type.enum';
import { DocumentStatus } from './domain/enums/document-status.enum';

describe('DocumentProcessingDomainService', () => {
  let service: DocumentProcessingDomainService;
  let mockRepository: jest.Mocked<DocumentRepositoryPort>;
  let mockStorage: jest.Mocked<StorageServicePort>;
  let mockOcr: jest.Mocked<OcrServicePort>;
  let mockAudit: jest.Mocked<AuditService>;

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
    } as any;

    mockOcr = {
      processDocument: jest.fn(),
    } as any;

    mockAudit = {
      logAuthEvent: jest.fn(),
    } as any;

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
        { provide: AuditService, useValue: mockAudit },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<DocumentProcessingDomainService>(
      DocumentProcessingDomainService,
    );
  });

  describe('uploadDocument', () => {
    it('should upload document and trigger processing', async () => {
      const userId = 'user-123';
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

      await service.uploadDocument(
        userId,
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
      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'doc-123',
        DocumentStatus.STORED,
        expect.objectContaining({
          rawFileUri: expect.stringContaining('gs://'),
        }),
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
      const fileBuffer = Buffer.from('SENSITIVE PATIENT DATA');
      const fileName = 'patient_john_doe_results.pdf';

      mockRepository.save.mockResolvedValue({
        id: 'doc-123',
        userId,
      } as any);

      mockStorage.storeRaw.mockResolvedValue('gs://bucket/raw/file.pdf');

      await service.uploadDocument(
        userId,
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
});
