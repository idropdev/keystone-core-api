import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMThreadService } from './anythingllm-thread.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';
import { AnythingLLMAdminEndpointIds } from '../registry/anythingllm-endpoints.registry';
import { UpstreamError } from '../registry/upstream-error';

describe('AnythingLLMThreadService', () => {
  let service: AnythingLLMThreadService;
  let mockRegistryClient: jest.Mocked<AnythingLLMRegistryClient>;
  let mockClientService: jest.Mocked<AnythingLLMClientService>;

  const mockResult = {
    data: { success: true, threadSlug: 'test-thread' },
    requestId: 'test-request-id',
    status: 200,
  };

  beforeEach(async () => {
    mockRegistryClient = {
      call: jest.fn().mockResolvedValue(mockResult),
      getEndpoint: jest.fn(),
    } as any;

    mockClientService = {
      callAnythingLLM: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMThreadService,
        {
          provide: AnythingLLMRegistryClient,
          useValue: mockRegistryClient,
        },
        {
          provide: AnythingLLMClientService,
          useValue: mockClientService,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMThreadService>(AnythingLLMThreadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createThread', () => {
    it('should call registry client with params and body', async () => {
      const workspaceSlug = 'test-workspace';
      const request = { name: 'Test Thread', userId: 1 };

      await service.createThread(workspaceSlug, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.CREATE_THREAD,
        { params: { slug: workspaceSlug }, body: request },
      );
    });
  });

  describe('updateThread', () => {
    it('should call registry client with params and body', async () => {
      const workspaceSlug = 'test-workspace';
      const threadSlug = 'test-thread';
      const request = { name: 'Updated Thread' };

      await service.updateThread(workspaceSlug, threadSlug, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.UPDATE_THREAD,
        { params: { slug: workspaceSlug, threadSlug }, body: request },
      );
    });
  });

  describe('deleteThread', () => {
    it('should call registry client with params', async () => {
      const workspaceSlug = 'test-workspace';
      const threadSlug = 'test-thread';

      await service.deleteThread(workspaceSlug, threadSlug);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.DELETE_THREAD,
        { params: { slug: workspaceSlug, threadSlug } },
      );
    });
  });

  describe('getThreadHistory', () => {
    it('should call registry client with params', async () => {
      const workspaceSlug = 'test-workspace';
      const threadSlug = 'test-thread';

      await service.getThreadHistory(workspaceSlug, threadSlug);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.GET_THREAD_CHATS,
        { params: { slug: workspaceSlug, threadSlug } },
      );
    });
  });

  describe('sendMessage', () => {
    it('should call registry client with params and body', async () => {
      const workspaceSlug = 'test-workspace';
      const threadSlug = 'test-thread';
      const request = {
        message: 'Test message',
        mode: 'query' as const,
        userId: 1,
      };

      await service.sendMessage(workspaceSlug, threadSlug, request);

      expect(mockRegistryClient.call).toHaveBeenCalledWith(
        AnythingLLMAdminEndpointIds.THREAD_CHAT,
        { params: { slug: workspaceSlug, threadSlug }, body: request },
      );
    });
  });

  describe('streamMessage', () => {
    it('should call client service directly for streaming', async () => {
      const workspaceSlug = 'test-workspace';
      const threadSlug = 'test-thread';
      const request = {
        message: 'Test message',
        mode: 'query' as const,
        userId: 1,
      };

      // Mock streaming response
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"id":"1","type":"textResponseChunk","textResponse":"chunk"}\n\n',
            ),
          );
          controller.close();
        },
      });

      mockClientService.callAnythingLLM.mockResolvedValue({
        ok: true,
        status: 200,
        body: mockStream,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
      } as any);

      const stream = await service.streamMessage(
        workspaceSlug,
        threadSlug,
        request,
      );

      expect(mockClientService.callAnythingLLM).toHaveBeenCalledWith(
        expect.stringContaining(
          `/v1/workspace/${workspaceSlug}/thread/${threadSlug}/stream-chat`,
        ),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          }),
        }),
      );

      expect(stream).toBeDefined();
    });

    it('should throw error if response is not ok', async () => {
      const workspaceSlug = 'test-workspace';
      const threadSlug = 'test-thread';
      const request = {
        message: 'Test message',
        mode: 'query' as const,
        userId: 1,
      };

      mockClientService.callAnythingLLM.mockResolvedValue({
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ error: 'Internal error' }),
        headers: new Headers(),
      } as any);

      await expect(
        service.streamMessage(workspaceSlug, threadSlug, request),
      ).rejects.toThrow();
    });
  });
});
