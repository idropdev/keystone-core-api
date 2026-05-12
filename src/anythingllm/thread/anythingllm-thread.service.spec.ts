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
    Pick<AnythingLLMUserProvisioningService, 'softDeleteThread'>
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
