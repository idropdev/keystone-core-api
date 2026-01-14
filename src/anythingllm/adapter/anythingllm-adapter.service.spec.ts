import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMAdapterService } from './anythingllm-adapter.service';
import { AnythingLLMWorkspaceService } from '../workspace/anythingllm-workspace.service';
import { AnythingLLMDocumentService } from '../document/anythingllm-document.service';
import { AnythingLLMThreadService } from '../thread/anythingllm-thread.service';
import { ThreadScopedChatService } from './thread-scoped-chat.service';
import { WorkspaceMapperService } from '../provisioning/domain/workspace-mapper.service';
import { AnythingLLMUserMappingRepository } from '../provisioning/infrastructure/persistence/repositories/anythingllm-user-mapping.repository';

describe('AnythingLLMAdapterService', () => {
  let service: AnythingLLMAdapterService;
  let mockWorkspaceService: jest.Mocked<AnythingLLMWorkspaceService>;
  let mockDocumentService: jest.Mocked<AnythingLLMDocumentService>;
  let mockThreadService: jest.Mocked<AnythingLLMThreadService>;
  let mockThreadScopedChatService: jest.Mocked<ThreadScopedChatService>;
  let mockWorkspaceMapper: jest.Mocked<WorkspaceMapperService>;
  let mockMappingRepository: jest.Mocked<AnythingLLMUserMappingRepository>;

  beforeEach(async () => {
    mockWorkspaceService = {
      createWorkspace: jest.fn(),
      getWorkspace: jest.fn(),
      listWorkspaces: jest.fn(),
      updateWorkspace: jest.fn(),
      deleteWorkspace: jest.fn(),
      updateEmbeddings: jest.fn(),
      updatePin: jest.fn(),
    } as any;

    mockDocumentService = {
      uploadFile: jest.fn(),
      uploadRawText: jest.fn(),
      listDocuments: jest.fn(),
      getDocument: jest.fn(),
    } as any;

    mockThreadService = {
      createThread: jest.fn(),
      updateThread: jest.fn(),
      deleteThread: jest.fn(),
      getThreadHistory: jest.fn(),
      sendMessage: jest.fn(),
      streamMessage: jest.fn(),
    } as any;

    mockThreadScopedChatService = {
      searchWithScope: jest.fn(),
      chatWithScope: jest.fn(),
      buildSystemPromptFromResults: jest.fn(),
    } as any;

    mockWorkspaceMapper = {
      getWorkspaceSlugForUser: jest.fn(),
      generateWorkspaceSlug: jest.fn().mockReturnValue('test-workspace-slug'),
    } as any;

    mockMappingRepository = {
      findByKeystoneUserId: jest.fn(),
      create: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMAdapterService,
        {
          provide: AnythingLLMWorkspaceService,
          useValue: mockWorkspaceService,
        },
        {
          provide: AnythingLLMDocumentService,
          useValue: mockDocumentService,
        },
        {
          provide: AnythingLLMThreadService,
          useValue: mockThreadService,
        },
        {
          provide: ThreadScopedChatService,
          useValue: mockThreadScopedChatService,
        },
        {
          provide: WorkspaceMapperService,
          useValue: mockWorkspaceMapper,
        },
        {
          provide: AnythingLLMUserMappingRepository,
          useValue: mockMappingRepository,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMAdapterService>(AnythingLLMAdapterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureWorkspaceForUser', () => {
    it('should return existing workspace if mapping exists', async () => {
      const userId = 'user-123';
      const workspaceSlug = 'existing-workspace';

      mockMappingRepository.findByKeystoneUserId.mockResolvedValue({
        keystoneUserId: userId,
        anythingllmUserId: 1,
        workspaceSlug,
      } as any);

      mockWorkspaceService.getWorkspace.mockResolvedValue({
        data: {
          id: 1,
          name: 'Existing Workspace',
          slug: workspaceSlug,
        },
        requestId: 'test-id',
        status: 200,
      });

      const result = await service.ensureWorkspaceForUser(userId);

      expect(result.slug).toBe(workspaceSlug);
      expect(mockWorkspaceService.createWorkspace).not.toHaveBeenCalled();
    });

    it('should create new workspace if mapping does not exist', async () => {
      const userId = 'user-123';
      const workspaceSlug = 'test-workspace-slug';

      mockMappingRepository.findByKeystoneUserId.mockResolvedValue(null);
      mockWorkspaceMapper.generateWorkspaceSlug.mockReturnValue(workspaceSlug);
      mockWorkspaceService.createWorkspace.mockResolvedValue({
        data: {
          success: true,
          workspace: {
            id: 1,
            name: 'New Workspace',
            slug: workspaceSlug,
          },
        },
        requestId: 'test-id',
        status: 200,
      });

      const result = await service.ensureWorkspaceForUser(userId);

      expect(result.slug).toBe(workspaceSlug);
      expect(mockWorkspaceService.createWorkspace).toHaveBeenCalled();
    });
  });

  describe('uploadDocument', () => {
    it('should upload document and attach to workspace', async () => {
      const userId = 'user-123';
      const file = Buffer.from('test content');
      const fileName = 'test.txt';
      const workspaceSlug = 'test-workspace';

      mockMappingRepository.findByKeystoneUserId.mockResolvedValue({
        keystoneUserId: userId,
        anythingllmUserId: 1,
        workspaceSlug,
      } as any);

      mockWorkspaceService.getWorkspace.mockResolvedValue({
        data: {
          id: 1,
          name: 'Test Workspace',
          slug: workspaceSlug,
        },
        requestId: 'test-id',
        status: 200,
      });

      mockDocumentService.uploadFile.mockResolvedValue({
        data: {
          success: true,
          documents: [
            {
              location: 'doc-location.json',
              name: 'test.txt',
              title: 'Test Document',
            },
          ],
        },
        requestId: 'test-id',
        status: 200,
      });

      mockWorkspaceService.updateEmbeddings.mockResolvedValue({
        data: { success: true },
        requestId: 'test-id',
        status: 200,
      });

      const result = await service.uploadDocument(userId, file, fileName);

      expect(result.location).toBe('doc-location.json');
      expect(mockDocumentService.uploadFile).toHaveBeenCalled();
      expect(mockWorkspaceService.updateEmbeddings).toHaveBeenCalled();
    });
  });

  describe('createThread', () => {
    it('should create thread in workspace', async () => {
      const workspaceSlug = 'test-workspace';
      const userId = 1;
      const threadName = 'Test Thread';

      mockThreadService.createThread.mockResolvedValue({
        data: {
          success: true,
          threadSlug: 'test-thread-slug',
        },
        requestId: 'test-id',
        status: 200,
      });

      const result = await service.createThread(
        workspaceSlug,
        userId,
        threadName,
      );

      expect(result.slug).toBe('test-thread-slug');
      expect(mockThreadService.createThread).toHaveBeenCalledWith(
        workspaceSlug,
        expect.objectContaining({
          userId,
          name: threadName,
        }),
      );
    });
  });

  describe('sendThreadMessage', () => {
    it('should use thread-scoped chat when documents are attached', async () => {
      const workspaceSlug = 'test-workspace';
      const threadSlug = 'test-thread';
      const userId = 1;
      const message = 'Test message';
      const attachedDocPaths = ['doc1.json', 'doc2.json'];

      mockThreadScopedChatService.chatWithScope.mockResolvedValue({
        id: 'chat-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-3.5-turbo',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Response' },
          },
        ],
      } as any);

      const result = await service.sendThreadMessage(
        workspaceSlug,
        threadSlug,
        userId,
        message,
        'query',
        attachedDocPaths,
      );

      expect(result.textResponse).toBe('Response');
      expect(mockThreadScopedChatService.chatWithScope).toHaveBeenCalled();
      expect(mockThreadService.sendMessage).not.toHaveBeenCalled();
    });

    it('should use normal thread chat when no documents attached', async () => {
      const workspaceSlug = 'test-workspace';
      const threadSlug = 'test-thread';
      const userId = 1;
      const message = 'Test message';

      mockThreadService.sendMessage.mockResolvedValue({
        data: {
          id: 'chat-123',
          type: 'textResponse',
          textResponse: 'Response',
        },
        requestId: 'test-id',
        status: 200,
      });

      const result = await service.sendThreadMessage(
        workspaceSlug,
        threadSlug,
        userId,
        message,
        'query',
      );

      expect(result.textResponse).toBe('Response');
      expect(mockThreadService.sendMessage).toHaveBeenCalled();
      expect(mockThreadScopedChatService.chatWithScope).not.toHaveBeenCalled();
    });
  });

  describe('searchWithScope', () => {
    it('should call thread-scoped chat service', async () => {
      const workspaceSlug = 'test-workspace';
      const query = 'test query';
      const docPaths = ['doc1.json'];
      const topN = 5;

      mockThreadScopedChatService.searchWithScope.mockResolvedValue([
        {
          text: 'result',
          source: 'doc1.json',
          score: 0.9,
        },
      ]);

      const result = await service.searchWithScope(
        workspaceSlug,
        query,
        docPaths,
        topN,
      );

      expect(result).toHaveLength(1);
      expect(mockThreadScopedChatService.searchWithScope).toHaveBeenCalledWith(
        workspaceSlug,
        query,
        docPaths,
        topN,
      );
    });
  });
});
