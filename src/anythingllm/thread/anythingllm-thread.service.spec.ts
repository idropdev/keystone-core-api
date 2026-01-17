import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMThreadService } from './anythingllm-thread.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';

import { AnythingLLMOrchestratorService } from '../../anythingllm-orchestrator/service';

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
        {
          provide: AnythingLLMOrchestratorService,
          useValue: { executeOperation: jest.fn() },
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
    it('should throw error (temporarily disabled)', async () => {
      await expect(service.deleteThread('ws', 'thread')).rejects.toThrow(
        'Non-admin thread endpoints have been temporarily disabled',
      );
    });
  });

  describe('getThreadHistory', () => {
    it('should throw error (temporarily disabled)', async () => {
      await expect(service.getThreadHistory('ws', 'thread')).rejects.toThrow(
        'Non-admin thread endpoints have been temporarily disabled',
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
