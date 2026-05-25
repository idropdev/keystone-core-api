import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { DocumentAccessDomainService } from './document-access.domain.service';
import { DocumentRepositoryPort } from '../ports/document.repository.port';
import {
  AccessGrantDomainService,
  Actor,
} from '../../../access-control/domain/services/access-grant.domain.service';
import { ManagerRepositoryPort } from '../../../managers/domain/repositories/manager.repository.port';
import { AuditService } from '../../../audit/audit.service';
import { Document } from '../entities/document.entity';
import { DocumentStatus } from '../enums/document-status.enum';

describe('DocumentAccessDomainService', () => {
  let service: DocumentAccessDomainService;
  let mockDocumentRepository: jest.Mocked<DocumentRepositoryPort>;
  let mockAccessGrantService: jest.Mocked<AccessGrantDomainService>;
  let mockManagerRepository: jest.Mocked<ManagerRepositoryPort>;
  let mockAuditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    mockDocumentRepository = {
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
      findByTemporaryManagerId: jest.fn(),
    } as any;

    mockAccessGrantService = {
      getActiveGrantsForSubject: jest.fn(),
      hasAccess: jest.fn(),
      grantAccess: jest.fn(),
      revokeAccess: jest.fn(),
    } as any;

    mockManagerRepository = {
      findByUserId: jest.fn(),
    } as any;

    mockAuditService = {
      logAuthEvent: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentAccessDomainService,
        { provide: 'DocumentRepositoryPort', useValue: mockDocumentRepository },
        { provide: AccessGrantDomainService, useValue: mockAccessGrantService },
        { provide: 'ManagerRepositoryPort', useValue: mockManagerRepository },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<DocumentAccessDomainService>(
      DocumentAccessDomainService,
    );
  });

  describe('listDocuments', () => {
    it('should include documents where user is the temporary manager (self-upload case)', async () => {
      const userActor: Actor = { type: 'user', id: 7 };
      const tempManagerDoc: Document = {
        id: 'doc-temp-1',
        fileName: 'self-upload.pdf',
        temporaryManagerId: 7,
        status: DocumentStatus.PROCESSED,
      } as Document;

      mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([]);
      mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue([
        tempManagerDoc,
      ]);
      mockDocumentRepository.findById.mockResolvedValue(tempManagerDoc);

      const result = await service.listDocuments(userActor, {
        skip: 0,
        limit: 10,
      });

      expect(
        mockDocumentRepository.findByTemporaryManagerId,
      ).toHaveBeenCalledWith(7);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('doc-temp-1');
      expect(result.total).toBe(1);
    });

    it('should deduplicate when the same doc appears via grant AND temporaryManagerId', async () => {
      const userActor: Actor = { type: 'user', id: 7 };
      const doc: Document = {
        id: 'doc-shared-1',
        fileName: 'shared.pdf',
        temporaryManagerId: 7,
        status: DocumentStatus.PROCESSED,
      } as Document;

      mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([
        {
          documentId: 'doc-shared-1',
          subjectType: 'user',
          subjectId: 7,
        } as any,
      ]);
      mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue([doc]);
      mockDocumentRepository.findById.mockResolvedValue(doc);

      const result = await service.listDocuments(userActor, {
        skip: 0,
        limit: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should return empty when user has neither grants nor self-uploaded docs', async () => {
      const userActor: Actor = { type: 'user', id: 99 };

      mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([]);
      mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue([]);

      const result = await service.listDocuments(userActor, {
        skip: 0,
        limit: 10,
      });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should NOT call findByTemporaryManagerId for manager actors (regression)', async () => {
      const managerActor: Actor = { type: 'manager', id: 5 };

      mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([]);
      mockManagerRepository.findByUserId.mockResolvedValue({ id: 10 } as any);

      await service.listDocuments(managerActor, { skip: 0, limit: 10 });

      expect(
        mockDocumentRepository.findByTemporaryManagerId,
      ).not.toHaveBeenCalled();
    });

    it('should hard deny admins and return empty list', async () => {
      const adminActor: Actor = { type: 'admin', id: 1 };

      const result = await service.listDocuments(adminActor, {
        skip: 0,
        limit: 10,
      });

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(
        mockDocumentRepository.findByTemporaryManagerId,
      ).not.toHaveBeenCalled();
    });

    it('should respect pagination options (skip and limit)', async () => {
      const userActor: Actor = { type: 'user', id: 7 };
      const docs: Document[] = Array.from(
        { length: 5 },
        (_, i) =>
          ({
            id: `doc-${i}`,
            fileName: `file-${i}.pdf`,
            status: DocumentStatus.PROCESSED,
          }) as Document,
      );

      mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([]);
      mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue(docs);
      mockDocumentRepository.findById.mockImplementation((id: string) =>
        Promise.resolve(docs.find((d) => d.id === id) || null),
      );

      const result = await service.listDocuments(userActor, {
        skip: 2,
        limit: 2,
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('doc-2');
      expect(result.data[1].id).toBe('doc-3');
      expect(result.total).toBe(5);
      expect(result.skip).toBe(2);
      expect(result.limit).toBe(2);
    });

    it('should combine grants and temporary manager docs without duplication', async () => {
      const userActor: Actor = { type: 'user', id: 7 };
      const grantedDoc: Document = {
        id: 'doc-granted',
        fileName: 'granted.pdf',
        status: DocumentStatus.PROCESSED,
      } as Document;
      const tempManagerDoc: Document = {
        id: 'doc-self',
        fileName: 'self.pdf',
        temporaryManagerId: 7,
        status: DocumentStatus.PROCESSED,
      } as Document;

      mockAccessGrantService.getActiveGrantsForSubject.mockResolvedValue([
        { documentId: 'doc-granted', subjectType: 'user', subjectId: 7 } as any,
      ]);
      mockDocumentRepository.findByTemporaryManagerId.mockResolvedValue([
        tempManagerDoc,
      ]);
      mockDocumentRepository.findById.mockImplementation((id: string) => {
        if (id === 'doc-granted') return Promise.resolve(grantedDoc);
        if (id === 'doc-self') return Promise.resolve(tempManagerDoc);
        return Promise.resolve(null);
      });

      const result = await service.listDocuments(userActor, {
        skip: 0,
        limit: 10,
      });

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.data.map((d) => d.id)).toContain('doc-granted');
      expect(result.data.map((d) => d.id)).toContain('doc-self');
    });
  });

  describe('getDocument', () => {
    it('should return document when user has access via grant', async () => {
      const userActor: Actor = { type: 'user', id: 1 };
      const document: Document = {
        id: 'doc-1',
        fileName: 'test.pdf',
        status: DocumentStatus.PROCESSED,
      } as Document;

      mockDocumentRepository.findById.mockResolvedValue(document);
      mockAccessGrantService.hasAccess.mockResolvedValue(true);

      const result = await service.getDocument('doc-1', userActor);

      expect(result).toEqual(document);
      expect(mockAccessGrantService.hasAccess).toHaveBeenCalledWith(
        'doc-1',
        'user',
        1,
      );
    });

    it('should throw NotFoundException when document does not exist', async () => {
      const userActor: Actor = { type: 'user', id: 1 };

      mockDocumentRepository.findById.mockResolvedValue(null);

      await expect(service.getDocument('doc-1', userActor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when user does not have access', async () => {
      const userActor: Actor = { type: 'user', id: 1 };
      const document: Document = {
        id: 'doc-1',
        fileName: 'test.pdf',
        status: DocumentStatus.PROCESSED,
      } as Document;

      mockDocumentRepository.findById.mockResolvedValue(document);
      mockAccessGrantService.hasAccess.mockResolvedValue(false);

      await expect(service.getDocument('doc-1', userActor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for admin actors', async () => {
      const adminActor: Actor = { type: 'admin', id: 1 };

      await expect(service.getDocument('doc-1', adminActor)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
