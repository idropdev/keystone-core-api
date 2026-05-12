import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMThreadService } from './anythingllm-thread.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';

import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';
import { AnythingLLMUserProvisioningService } from '../provisioning/anythingllm-user-provisioning.service';
import { AnythingLLMOperation } from '../../anythingllm-policy/domain/anythingllm-operation.enum';

describe('AnythingLLMThreadService', () => {
  let service: AnythingLLMThreadService;
  let mockRegistryClient: jest.Mocked<AnythingLLMRegistryClient>;
  let mockClientService: jest.Mocked<AnythingLLMClientService>;
  let mockOrchestratorService: jest.Mocked<AnythingLLMOrchestratorService>;
  let mockUserProvisioningService: jest.Mocked<
    Pick<
      AnythingLLMUserProvisioningService,
      'softDeleteThread' | 'getUserThreads'
    >
  >;

  const mockResult = {
    data: { success: true, threadSlug: 'test-thread' },
    requestId: 'test-request-id',
    status: 200,
  };

  const makeFakeOkResponse = (body: unknown = { success: true }): Response =>
    ({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(body),
      text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    }) as any as Response;

  beforeEach(async () => {
    mockRegistryClient = {
      call: jest.fn().mockResolvedValue(mockResult),
      getEndpoint: jest.fn(),
    } as any;

    mockClientService = {
      callAnythingLLM: jest.fn(),
    } as any;

    mockOrchestratorService = {
      executeOperation: jest.fn(),
    } as any;

    mockUserProvisioningService = {
      softDeleteThread: jest.fn().mockResolvedValue(undefined),
      getUserThreads: jest.fn(),
    };

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
        {
          provide: AnythingLLMOrchestratorService,
          useValue: mockOrchestratorService,
        },
        {
          provide: AnythingLLMUserProvisioningService,
          useValue: mockUserProvisioningService,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMThreadService>(AnythingLLMThreadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createThread', () => {
    it('should call client service with correct path and body', async () => {
      const workspaceSlug = 'test-workspace';
      const request = { name: 'Test Thread', userId: 1 };

      await service.createThread(workspaceSlug, request);

      expect(
        (service as any).clientService.callAnythingLLM,
      ).toHaveBeenCalledWith(`/v1/workspace/${workspaceSlug}/thread/new`, {
        method: 'POST',
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('updateThread', () => {
    it('should throw error (temporarily disabled)', async () => {
      await expect(
        service.updateThread('ws', 'thread', { name: 'update' }),
      ).rejects.toThrow(
        'Non-admin thread endpoints have been temporarily disabled',
      );
    });
  });

  describe('deleteThread', () => {
    it('should call clientService directly when no requesterContext', async () => {
      const fakeResponse = makeFakeOkResponse();
      mockClientService.callAnythingLLM.mockResolvedValue(fakeResponse);

      const result = await service.deleteThread('my-workspace', 'my-thread');

      expect(mockClientService.callAnythingLLM).toHaveBeenCalledWith(
        '/v1/workspace/my-workspace/thread/my-thread',
        { method: 'DELETE' },
      );
      expect(result).toBe(fakeResponse);
    });

    it('should call orchestratorService when requesterContext is provided', async () => {
      const fakeResponse = makeFakeOkResponse();
      mockOrchestratorService.executeOperation.mockResolvedValue(fakeResponse);

      const requesterContext = { userId: '42', roles: ['user'] } as any;
      const result = await service.deleteThread(
        'my-workspace',
        'my-thread',
        requesterContext,
      );

      expect(mockOrchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: AnythingLLMOperation.THREAD_DELETE,
          endpoint: '/v1/workspace/my-workspace/thread/my-thread',
          method: 'DELETE',
          requesterContext,
          resourceContext: {
            workspaceSlug: 'my-workspace',
            threadSlug: 'my-thread',
          },
        }),
      );
      expect(result).toBe(fakeResponse);
    });

    it('should soft-delete local mirror on upstream success', async () => {
      const fakeResponse = makeFakeOkResponse();
      mockClientService.callAnythingLLM.mockResolvedValue(fakeResponse);

      await service.deleteThread('my-workspace', 'my-thread');

      expect(mockUserProvisioningService.softDeleteThread).toHaveBeenCalledWith(
        'my-thread',
      );
    });

    it('should return upstream response even when local soft-delete throws', async () => {
      const fakeResponse = makeFakeOkResponse();
      mockClientService.callAnythingLLM.mockResolvedValue(fakeResponse);
      mockUserProvisioningService.softDeleteThread = jest
        .fn()
        .mockRejectedValue(new Error('DB error'));

      const result = await service.deleteThread('my-workspace', 'my-thread');

      expect(result).toBe(fakeResponse);
    });

    it('should NOT soft-delete the local mirror when upstream delete fails', async () => {
      const upstreamFailureResponse = {
        ok: false,
        status: 502,
        text: jest.fn().mockResolvedValue('upstream error'),
        json: jest.fn().mockResolvedValue({}),
      } as any as Response;
      mockClientService.callAnythingLLM.mockResolvedValue(
        upstreamFailureResponse,
      );

      const result = await service.deleteThread('ws-1', 'thread-1');

      expect(result).toBe(upstreamFailureResponse);
      expect(
        mockUserProvisioningService.softDeleteThread,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getThreadHistory', () => {
    it('should call clientService directly when no requesterContext', async () => {
      const fakeResponse = makeFakeOkResponse({ chats: [] });
      mockClientService.callAnythingLLM.mockResolvedValue(fakeResponse);

      const result = await service.getThreadHistory(
        'my-workspace',
        'my-thread',
      );

      expect(mockClientService.callAnythingLLM).toHaveBeenCalledWith(
        '/v1/workspace/my-workspace/thread/my-thread/chats',
        { method: 'GET' },
      );
      expect(result).toBe(fakeResponse);
    });

    it('should call orchestratorService when requesterContext is provided', async () => {
      const fakeResponse = makeFakeOkResponse({ chats: [] });
      mockOrchestratorService.executeOperation.mockResolvedValue(fakeResponse);

      const requesterContext = { userId: '42', roles: ['user'] } as any;
      const result = await service.getThreadHistory(
        'my-workspace',
        'my-thread',
        requesterContext,
      );

      expect(mockOrchestratorService.executeOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: AnythingLLMOperation.THREAD_HISTORY,
          endpoint: '/v1/workspace/my-workspace/thread/my-thread/chats',
          method: 'GET',
          requesterContext,
          resourceContext: {
            workspaceSlug: 'my-workspace',
            threadSlug: 'my-thread',
          },
        }),
      );
      expect(result).toBe(fakeResponse);
    });
  });

  describe('listThreads', () => {
    it('should return threads for the user filtered by workspace slug and mapped to ThreadListItem shape', async () => {
      const repoRows = [
        {
          threadSlug: 'thread-a',
          threadName: 'Cold symptoms',
          workspaceSlug: 'user-1-ws',
          workspaceId: 1,
          messageCount: 4,
          lastMessageAt: new Date('2026-05-10T10:00:00Z'),
          createdAt: new Date('2026-05-01T10:00:00Z'),
        },
        {
          threadSlug: 'thread-b',
          threadName: 'Lab results',
          workspaceSlug: 'user-1-ws',
          workspaceId: 1,
          messageCount: 1,
          lastMessageAt: null,
          createdAt: new Date('2026-05-02T10:00:00Z'),
        },
        {
          // Different workspace — should be filtered out
          threadSlug: 'thread-c',
          threadName: 'Other',
          workspaceSlug: 'user-1-other-ws',
          workspaceId: 2,
          messageCount: 0,
          lastMessageAt: null,
          createdAt: new Date('2026-05-03T10:00:00Z'),
        },
      ];
      mockUserProvisioningService.getUserThreads.mockResolvedValue(repoRows);

      const result = await service.listThreads('user-1-ws', '42');

      expect(mockUserProvisioningService.getUserThreads).toHaveBeenCalledWith(
        '42',
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        slug: 'thread-a',
        name: 'Cold symptoms',
        workspaceSlug: 'user-1-ws',
        messageCount: 4,
        lastMessageAt: new Date('2026-05-10T10:00:00Z').toISOString(),
        createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
      });
      expect(result[1].slug).toBe('thread-b');
      expect(result[1].lastMessageAt).toBeNull();
    });

    it('should return an empty array when the user has no threads', async () => {
      mockUserProvisioningService.getUserThreads.mockResolvedValue([]);
      const result = await service.listThreads('user-1-ws', '42');
      expect(result).toEqual([]);
    });

    it('should return an empty array when no threads match the workspace slug', async () => {
      mockUserProvisioningService.getUserThreads.mockResolvedValue([
        {
          threadSlug: 'thread-a',
          threadName: 'x',
          workspaceSlug: 'other-ws',
          workspaceId: 5,
          messageCount: 1,
          lastMessageAt: null,
          createdAt: new Date('2026-05-01T10:00:00Z'),
        },
      ]);
      const result = await service.listThreads('user-1-ws', '42');
      expect(result).toEqual([]);
    });

    it('should accept a numeric keystone user id', async () => {
      mockUserProvisioningService.getUserThreads.mockResolvedValue([]);
      await service.listThreads('user-1-ws', 42);
      expect(mockUserProvisioningService.getUserThreads).toHaveBeenCalledWith(
        42,
      );
    });
  });

  describe('sendMessage', () => {
    it('should throw error (temporarily disabled)', async () => {
      const request = {
        message: 'Test message',
        mode: 'query' as const,
        userId: 1,
      };
      await expect(
        service.sendMessage('ws', 'thread', request),
      ).rejects.toThrow(
        'Non-admin thread endpoints have been temporarily disabled',
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
