import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMVectorSearchService } from './anythingllm-vector-search.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';

describe('AnythingLLMVectorSearchService', () => {
  let service: AnythingLLMVectorSearchService;
  let mockRegistryClient: jest.Mocked<AnythingLLMRegistryClient>;

  const mockResult = {
    data: { results: [] },
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
        AnythingLLMVectorSearchService,
        {
          provide: AnythingLLMRegistryClient,
          useValue: mockRegistryClient,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMVectorSearchService>(
      AnythingLLMVectorSearchService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('search', () => {
    it('should throw error (temporarily disabled)', async () => {
      const workspaceSlug = 'test-workspace';
      const request = {
        query: 'test query',
        topN: 5,
        scoreThreshold: 0.7,
      };

      await expect(service.search(workspaceSlug, request)).rejects.toThrow(
        'Non-admin vector-search endpoints have been temporarily disabled',
      );
    });
  });

  describe('chatCompletions', () => {
    it('should throw error (temporarily disabled)', async () => {
      const request = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await expect(service.chatCompletions(request)).rejects.toThrow(
        'Non-admin vector-search endpoints have been temporarily disabled',
      );
    });
  });

  describe('embeddings', () => {
    it('should throw error (temporarily disabled)', async () => {
      const request = {
        model: 'text-embedding-ada-002',
        input: 'test text',
      };

      await expect(service.embeddings(request)).rejects.toThrow(
        'Non-admin vector-search endpoints have been temporarily disabled',
      );
    });
  });
});
