import { Test, TestingModule } from '@nestjs/testing';
import { ThreadScopedChatService } from './thread-scoped-chat.service';
import { AnythingLLMVectorSearchService } from '../vector-search/anythingllm-vector-search.service';

describe('ThreadScopedChatService', () => {
  let service: ThreadScopedChatService;
  let mockVectorSearchService: jest.Mocked<AnythingLLMVectorSearchService>;

  beforeEach(async () => {
    mockVectorSearchService = {
      search: jest.fn(),
      chatCompletions: jest.fn(),
      embeddings: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadScopedChatService,
        {
          provide: AnythingLLMVectorSearchService,
          useValue: mockVectorSearchService,
        },
      ],
    }).compile();

    service = module.get<ThreadScopedChatService>(ThreadScopedChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('searchWithScope', () => {
    it('should call vector search with docPaths filter', async () => {
      const workspaceSlug = 'test-workspace';
      const query = 'test query';
      const docPaths = ['doc1.json', 'doc2.json'];
      const topN = 5;
      const scoreThreshold = 0.7;

      mockVectorSearchService.search.mockResolvedValue({
        data: { results: [] },
        requestId: 'test-id',
        status: 200,
      });

      await service.searchWithScope(
        workspaceSlug,
        query,
        docPaths,
        topN,
        scoreThreshold,
      );

      expect(mockVectorSearchService.search).toHaveBeenCalledWith(
        workspaceSlug,
        expect.objectContaining({
          query,
          topN,
          scoreThreshold,
          docPaths,
        }),
      );
    });
  });

  describe('chatWithScope', () => {
    it('should perform vector search then chat completions', async () => {
      const workspaceSlug = 'test-workspace';
      const messages = [{ role: 'user', content: 'test query' }];
      const docPaths = ['doc1.json'];
      const model = 'gpt-3.5-turbo';
      const temperature = 0.7;

      mockVectorSearchService.search.mockResolvedValue({
        data: {
          results: [
            {
              text: 'chunk 1',
              source: 'doc1.json',
              score: 0.9,
            },
          ],
        },
        requestId: 'test-id',
        status: 200,
      });

      mockVectorSearchService.chatCompletions.mockResolvedValue({
        data: {
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
        },
        requestId: 'test-id',
        status: 200,
      });

      const result = await service.chatWithScope(
        workspaceSlug,
        messages,
        docPaths,
        model,
        temperature,
      );

      expect(mockVectorSearchService.search).toHaveBeenCalled();
      expect(mockVectorSearchService.chatCompletions).toHaveBeenCalledWith(
        expect.objectContaining({
          model,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            ...messages,
          ]),
          temperature,
        }),
      );

      expect(result).toBeDefined();
    });
  });

  describe('buildSystemPromptFromResults', () => {
    it('should build system prompt from search results', () => {
      const searchResults = [
        { text: 'chunk 1', source: 'doc1.json', score: 0.9 },
        { text: 'chunk 2', source: 'doc2.json', score: 0.8 },
      ];

      const prompt = service.buildSystemPromptFromResults(searchResults);

      expect(prompt).toContain('chunk 1');
      expect(prompt).toContain('chunk 2');
      expect(prompt).toContain('doc1.json');
      expect(prompt).toContain('doc2.json');
    });

    it('should use custom instructions if provided', () => {
      const searchResults = [
        { text: 'chunk 1', source: 'doc1.json', score: 0.9 },
      ];
      const customInstructions = 'Custom instructions here';

      const prompt = service.buildSystemPromptFromResults(
        searchResults,
        customInstructions,
      );

      expect(prompt).toContain(customInstructions);
    });
  });
});





