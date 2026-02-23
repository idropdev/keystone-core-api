import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMChatService } from './anythingllm-chat.service';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AccessGrantDomainService } from '../../access-control/domain/services/access-grant.domain.service';
import { DocumentAnythingLLMPathRepository } from '../provisioning/infrastructure/persistence/repositories/document-anythingllm-path.repository';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';

describe('AnythingLLMChatService', () => {
  let service: AnythingLLMChatService;
  let orchestrator: { executeOperation: jest.Mock };
  let accessGrantService: { hasAccess: jest.Mock };
  let pathRepo: { findByDocumentIdsAndWorkspaceSlug: jest.Mock };

  beforeEach(async () => {
    orchestrator = { executeOperation: jest.fn() };
    accessGrantService = { hasAccess: jest.fn() };
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

  it('should use full-scope when documentIds is empty', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"1","type":"textResponseChunk","textResponse":"hi","close":true}\n\n',
          ),
        );
        controller.close();
      },
    });

    orchestrator.executeOperation.mockResolvedValue({
      ok: true,
      status: 200,
      body: mockStream,
      text: jest.fn(),
    } as any);

    const stream = await service.streamChatWithDocuments(
      { workspaceSlug: 'ws-1', message: 'hello', documentIds: [] },
      requesterContext as any,
    );

    expect(orchestrator.executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: AnythingLLMOperation.CHAT_WITH_DOCS,
        endpoint: expect.stringContaining('/v1/workspace/ws-1/stream-chat'),
        body: expect.objectContaining({
          documentPaths: ['*'],
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

  it('should validate access and resolve paths for defined scope', async () => {
    const docId = '2e6e9b1b-6c2c-4b4c-9e2b-9f1d5f3d9b1a';
    accessGrantService.hasAccess.mockResolvedValue(true);
    pathRepo.findByDocumentIdsAndWorkspaceSlug.mockResolvedValue([
      { documentId: docId, anythingllmDocPath: 'custom-documents/doc.json' },
    ]);

    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"1","type":"textResponseChunk","textResponse":"ok","close":true}\n\n',
          ),
        );
        controller.close();
      },
    });

    orchestrator.executeOperation.mockResolvedValue({
      ok: true,
      status: 200,
      body: mockStream,
      text: jest.fn(),
    } as any);

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
