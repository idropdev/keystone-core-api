import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMWorkspaceService } from './anythingllm-workspace.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';

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
        {
          provide: AnythingLLMOrchestratorService,
          useValue: { executeOperation: jest.fn() },
        },
        {
          provide: AnythingLLMClientService,
          useValue: { callAnythingLLM: jest.fn() },
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
    it('should call client service with request body when no user context', async () => {
      const request = { name: 'Test Workspace', slug: 'test-workspace' };

      await service.createWorkspace(request);

      expect(
        (service as any).clientService.callAnythingLLM,
      ).toHaveBeenCalledWith('/v1/workspace/new', {
        method: 'POST',
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('listWorkspaces', () => {
    it('should throw error (temporarily disabled)', async () => {
      await expect(service.listWorkspaces()).rejects.toThrow(
        'Non-admin workspace endpoints have been temporarily disabled',
      );
    });
  });

  describe('getWorkspace', () => {
    it('should throw error (temporarily disabled)', async () => {
      await expect(service.getWorkspace('slug')).rejects.toThrow(
        'Non-admin workspace endpoints have been temporarily disabled',
      );
    });
  });

  describe('updateWorkspace', () => {
    it('should throw error (temporarily disabled)', async () => {
      const request = { name: 'Updated Workspace' };
      await expect(service.updateWorkspace('slug', request)).rejects.toThrow(
        'Non-admin workspace endpoints have been temporarily disabled',
      );
    });
  });

  describe('deleteWorkspace', () => {
    it('should throw error (temporarily disabled)', async () => {
      await expect(service.deleteWorkspace('slug')).rejects.toThrow(
        'Non-admin workspace endpoints have been temporarily disabled',
      );
    });
  });

  describe('updateEmbeddings', () => {
    it('should throw error (temporarily disabled)', async () => {
      const request = { adds: ['doc1.json'], deletes: ['doc2.json'] };
      await expect(service.updateEmbeddings('slug', request)).rejects.toThrow(
        'Non-admin workspace endpoints have been temporarily disabled',
      );
    });
  });

  describe('updatePin', () => {
    it('should throw error (temporarily disabled)', async () => {
      const request = { docPath: 'doc1.json', pinned: true };
      await expect(service.updatePin('slug', request)).rejects.toThrow(
        'Non-admin workspace endpoints have been temporarily disabled',
      );
    });
  });
});
