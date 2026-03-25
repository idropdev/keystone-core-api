import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMChatService } from './anythingllm-chat.service';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AccessGrantDomainService } from '../../access-control/domain/services/access-grant.domain.service';
import { DocumentAnythingLLMPathRepository } from '../provisioning/infrastructure/persistence/repositories/document-anythingllm-path.repository';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';

describe('AnythingLLMChatService', () => {
  let service: AnythingLLMChatService;
  let orchestrator: { executeOperation: jest.Mock };
  let accessGrantService: {
    hasAccess: jest.Mock;
    getAccessibleDocumentIds: jest.Mock;
  };
  let pathRepo: { findByDocumentIdsAndWorkspaceSlug: jest.Mock };

  beforeEach(async () => {
    orchestrator = { executeOperation: jest.fn() };
    accessGrantService = {
      hasAccess: jest.fn(),
      getAccessibleDocumentIds: jest.fn(),
    };
    pathRepo = { findByDocumentIdsAndWorkspaceSlug: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMChatService,
        {
          provide: AnythingLLMOrchestratorService,
          useValue: orchestrator,
        },
        {
          provide: AccessGrantDomainService,
          useValue: accessGrantService,
        },
        {
          provide: DocumentAnythingLLMPathRepository,
          useValue: pathRepo,
        },
      ],
    }).compile();

    service = module.get(AnythingLLMChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const requesterContext = {
    userId: '123',
    roles: ['user'],
    sessionId: 'sess-1',
    provider: 'system',
  };

  function createMockSseStream(data: object) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`),
        );
        controller.close();
      },
    });
  }

  function mockSuccessUpstream(data: object) {
    orchestrator.executeOperation.mockResolvedValue({
      ok: true,
      status: 200,
      body: createMockSseStream(data),
      text: jest.fn(),
    } as any);
  }

  // ─── Full-scope tests (RBAC-aware) ───

  it('should resolve RBAC-filtered docs and send allowedDocIds for full-scope', async () => {
    const docId1 = '2e6e9b1b-6c2c-4b4c-9e2b-9f1d5f3d9b1a';
    const docId2 = '3f7f0c2c-7d3d-5c5d-af3c-0g2e6g4e0c2b';
    const anythingllmUuid1 = 'd14e9d15-b654-46b7-84dc-0414d1e7d131';
    const anythingllmUuid2 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    accessGrantService.getAccessibleDocumentIds.mockResolvedValue([
      docId1,
      docId2,
    ]);
    pathRepo.findByDocumentIdsAndWorkspaceSlug.mockResolvedValue([
      {
        documentId: docId1,
        anythingllmDocPath: `custom-documents/doc1.pdf-${anythingllmUuid1}.json`,
      },
      {
        documentId: docId2,
        anythingllmDocPath: `custom-documents/doc2.pdf-${anythingllmUuid2}.json`,
      },
    ]);

    mockSuccessUpstream({
      id: '1',
      type: 'textResponseChunk',
      textResponse: 'hi',
      close: true,
    });

    const stream = await service.streamChatWithDocuments(
      { workspaceSlug: 'ws-1', message: 'hello', documentIds: [] },
      requesterContext as any,
    );

    expect(accessGrantService.getAccessibleDocumentIds).toHaveBeenCalledWith(
      'user',
      123,
    );

    expect(pathRepo.findByDocumentIdsAndWorkspaceSlug).toHaveBeenCalledWith(
      [docId1, docId2],
      'ws-1',
    );

    expect(orchestrator.executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: AnythingLLMOperation.CHAT_WITH_DOCS,
        endpoint: expect.stringContaining('/v1/workspace/ws-1/stream-chat'),
        body: expect.objectContaining({
          documentPaths: ['*'],
          allowedDocIds: [anythingllmUuid1, anythingllmUuid2],
          message: 'hello',
        }),
      }),
    );

    const reader = stream.getReader();
    const { value } = await reader.read();
    expect(value).toEqual(
      expect.objectContaining({ id: '1', close: true, textResponse: 'hi' }),
    );
    reader.releaseLock();
  });

  it('should send allowedDocIds for wildcard documentIds ["*"]', async () => {
    const docId = '2e6e9b1b-6c2c-4b4c-9e2b-9f1d5f3d9b1a';
    const anythingllmUuid = 'd14e9d15-b654-46b7-84dc-0414d1e7d131';

    accessGrantService.getAccessibleDocumentIds.mockResolvedValue([docId]);
    pathRepo.findByDocumentIdsAndWorkspaceSlug.mockResolvedValue([
      {
        documentId: docId,
        anythingllmDocPath: `custom-documents/doc.pdf-${anythingllmUuid}.json`,
      },
    ]);

    mockSuccessUpstream({
      id: '1',
      type: 'textResponseChunk',
      textResponse: 'ok',
      close: true,
    });

    await service.streamChatWithDocuments(
      { workspaceSlug: 'ws-1', message: 'hello', documentIds: ['*'] },
      requesterContext as any,
    );

    expect(orchestrator.executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          documentPaths: ['*'],
          allowedDocIds: [anythingllmUuid],
        }),
      }),
    );
  });

  it('should throw 403 when user has no accessible documents (full-scope)', async () => {
    accessGrantService.getAccessibleDocumentIds.mockResolvedValue([]);

    await expect(
      service.streamChatWithDocuments(
        { workspaceSlug: 'ws-1', message: 'hello', documentIds: [] },
        requesterContext as any,
      ),
    ).rejects.toThrow('User has no accessible documents');

    expect(orchestrator.executeOperation).not.toHaveBeenCalled();
  });

  it('should throw 400 when accessible docs have no workspace mappings (full-scope)', async () => {
    accessGrantService.getAccessibleDocumentIds.mockResolvedValue([
      '2e6e9b1b-6c2c-4b4c-9e2b-9f1d5f3d9b1a',
    ]);
    pathRepo.findByDocumentIdsAndWorkspaceSlug.mockResolvedValue([]);

    await expect(
      service.streamChatWithDocuments(
        { workspaceSlug: 'ws-1', message: 'hello', documentIds: [] },
        requesterContext as any,
      ),
    ).rejects.toThrow('No accessible documents found in this workspace');

    expect(orchestrator.executeOperation).not.toHaveBeenCalled();
  });

  // ─── Defined-scope tests (unchanged behavior) ───

  it('should validate access and resolve paths for defined scope', async () => {
    const docId = '2e6e9b1b-6c2c-4b4c-9e2b-9f1d5f3d9b1a';
    accessGrantService.hasAccess.mockResolvedValue(true);
    pathRepo.findByDocumentIdsAndWorkspaceSlug.mockResolvedValue([
      { documentId: docId, anythingllmDocPath: 'custom-documents/doc.json' },
    ]);

    mockSuccessUpstream({
      id: '1',
      type: 'textResponseChunk',
      textResponse: 'ok',
      close: true,
    });

    await service.streamChatWithDocuments(
      { workspaceSlug: 'ws-1', message: 'hello', documentIds: [docId] },
      requesterContext as any,
    );

    expect(accessGrantService.hasAccess).toHaveBeenCalledWith(
      docId,
      'user',
      123,
    );

    expect(pathRepo.findByDocumentIdsAndWorkspaceSlug).toHaveBeenCalledWith(
      [docId],
      'ws-1',
    );

    expect(orchestrator.executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          documentPaths: ['custom-documents/doc.json'],
          allowedDocIds: undefined,
        }),
      }),
    );
  });

  it('should throw 403 when user lacks access to any requested document', async () => {
    const docId = '2e6e9b1b-6c2c-4b4c-9e2b-9f1d5f3d9b1a';
    accessGrantService.hasAccess.mockResolvedValue(false);

    await expect(
      service.streamChatWithDocuments(
        { workspaceSlug: 'ws-1', message: 'hello', documentIds: [docId] },
        requesterContext as any,
      ),
    ).rejects.toThrow('User does not have access to one or more documents');

    expect(orchestrator.executeOperation).not.toHaveBeenCalled();
  });

  it('should throw 400 when mapping is missing', async () => {
    const docId = '2e6e9b1b-6c2c-4b4c-9e2b-9f1d5f3d9b1a';
    accessGrantService.hasAccess.mockResolvedValue(true);
    pathRepo.findByDocumentIdsAndWorkspaceSlug.mockResolvedValue([]);

    await expect(
      service.streamChatWithDocuments(
        { workspaceSlug: 'ws-1', message: 'hello', documentIds: [docId] },
        requesterContext as any,
      ),
    ).rejects.toThrow('Document not available for chat');

    expect(orchestrator.executeOperation).not.toHaveBeenCalled();
  });
});
