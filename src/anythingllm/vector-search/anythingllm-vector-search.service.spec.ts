import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMVectorSearchService } from './anythingllm-vector-search.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';

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
    it('should call registry client with params and body', async () => {
      const workspaceSlug = 'test-workspace';
      const request = {
        query: 'test query',
        topN: 5,
        scoreThreshold: 0.7,
      };

      await service.search(workspaceSlug, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.VECTOR_SEARCH,
        { params: { slug: workspaceSlug }, body: request },
      );
    });
  });

  describe('chatCompletions', () => {
    it('should call registry client with request body', async () => {
      const request = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      await service.chatCompletions(request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.OPENAI_CHAT_COMPLETIONS,
        { body: request },
      );
    });
  });

  describe('embeddings', () => {
    it('should call registry client with request body', async () => {
      const request = {
        model: 'text-embedding-ada-002',
        input: 'test text',
      };

      await service.embeddings(request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.OPENAI_EMBEDDINGS,
        { body: request },
      );
    });
  });
});





