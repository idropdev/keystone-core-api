import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMWorkspaceService } from './anythingllm-workspace.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';

describe('AnythingLLMWorkspaceService', () => {
  let service: AnythingLLMWorkspaceService;
  let mockRegistryClient: jest.Mocked<AnythingLLMRegistryClient>;

  const mockResult = {
    data: { success: true },
    requestId: 'test-request-id',
    status: 200,
  };

  beforeEach(async () => {
    mockRegistryClient = {
      call: jest.fn().mockResolvedValue(mockResult),
      getEndpoint: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMWorkspaceService,
        {
          provide: AnythingLLMRegistryClient,
          useValue: mockRegistryClient,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMWorkspaceService>(
      AnythingLLMWorkspaceService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createWorkspace', () => {
    it('should call registry client with request body', async () => {
      const request = { name: 'Test Workspace', slug: 'test-workspace' };

      await service.createWorkspace(request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.CREATE_WORKSPACE,
        { body: request },
      );
    });
  });

  describe('listWorkspaces', () => {
    it('should call registry client with correct endpoint', async () => {
      await service.listWorkspaces();

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.LIST_WORKSPACES,
      );
    });
  });

  describe('getWorkspace', () => {
    it('should call registry client with slug param', async () => {
      const slug = 'test-workspace';

      await service.getWorkspace(slug);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.GET_WORKSPACE,
        { params: { slug } },
      );
    });
  });

  describe('updateWorkspace', () => {
    it('should call registry client with params and body', async () => {
      const slug = 'test-workspace';
      const request = { name: 'Updated Workspace' };

      await service.updateWorkspace(slug, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.UPDATE_WORKSPACE,
        { params: { slug }, body: request },
      );
    });
  });

  describe('deleteWorkspace', () => {
    it('should call registry client with slug param', async () => {
      const slug = 'test-workspace';

      await service.deleteWorkspace(slug);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.DELETE_WORKSPACE,
        { params: { slug } },
      );
    });
  });

  describe('updateEmbeddings', () => {
    it('should call registry client with params and body', async () => {
      const slug = 'test-workspace';
      const request = { adds: ['doc1.json'], deletes: ['doc2.json'] };

      await service.updateEmbeddings(slug, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.UPDATE_WORKSPACE_EMBEDDINGS,
        { params: { slug }, body: request },
      );
    });
  });

  describe('updatePin', () => {
    it('should call registry client with params and body', async () => {
      const slug = 'test-workspace';
      const request = { docPath: 'doc1.json', pinned: true };

      await service.updatePin(slug, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.UPDATE_WORKSPACE_PIN,
        { params: { slug }, body: request },
      );
    });
  });
});





