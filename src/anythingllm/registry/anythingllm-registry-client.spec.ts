import { Test, TestingModule } from '@nestjs/testing';
import { AnythingLLMRegistryClient } from './anythingllm-registry-client';
import { AnythingLLMClientService } from '../services/anythingllm-client.service';
import { UpstreamError } from './upstream-error';
import { AnythingLLMAdminEndpointIds } from './anythingllm-endpoints.registry';

describe('AnythingLLMRegistryClient', () => {
  let service: AnythingLLMRegistryClient;
  let mockClientService: jest.Mocked<AnythingLLMClientService>;

  beforeEach(async () => {
    // Create mock client service
    mockClientService = {
      callAnythingLLM: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMRegistryClient,
        {
          provide: AnythingLLMClientService,
          useValue: mockClientService,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMRegistryClient>(AnythingLLMRegistryClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('call', () => {
    const mockResponseBody = { isMultiUser: true };

    beforeEach(() => {
      mockClientService.callAnythingLLM.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockResponseBody),
        headers: new Headers({ 'content-type': 'application/json' }),
      } as any);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should call client service with correct path', async () => {
      await service.call(AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE);

      expect(mockClientService.callAnythingLLM).toHaveBeenCalledWith(
        '/v1/admin/is-multi-user-mode',
        expect.any(Object),
      );
    });

    it('should return typed response data', async () => {
      const result = await service.call(
        AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE,
      );

      expect(result.data).toEqual(mockResponseBody);
      expect(result.status).toBe(200);
      expect(result.requestId).toBeDefined();
    });

    it('should substitute path parameters', async () => {
      await service.call(AnythingLLMAdminEndpointIds.UPDATE_USER, {
        params: { id: 123 },
        body: { role: 'admin' },
      });

      expect(mockClientService.callAnythingLLM).toHaveBeenCalledWith(
        '/v1/admin/users/123',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ role: 'admin' }),
        }),
      );
    });

    it('should throw error for unknown endpoint ID', async () => {
      await expect(
        service.call('unknown.endpoint' as any),
      ).rejects.toThrow('Unknown endpoint ID: unknown.endpoint');
    });

    it('should call with unsubstituted path params if not provided', async () => {
      // When path params are missing, the URL will contain :id placeholder
      // which will be passed to the client service
      await service.call(AnythingLLMAdminEndpointIds.UPDATE_USER, { body: {} });

      expect(mockClientService.callAnythingLLM).toHaveBeenCalledWith(
        expect.stringContaining(':id'),
        expect.any(Object),
      );
    });

    it('should throw UpstreamError on non-OK response', async () => {
      mockClientService.callAnythingLLM.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn().mockResolvedValue('{"error":"Not found"}'),
        headers: new Headers(),
      } as any);

      await expect(
        service.call(AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE),
      ).rejects.toThrow(UpstreamError);
    });

    it('should throw UpstreamError on network error', async () => {
      mockClientService.callAnythingLLM.mockRejectedValue(
        new Error('Network error'),
      );

      await expect(
        service.call(AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE),
      ).rejects.toThrow(UpstreamError);
    });

    it('should include requestId in response', async () => {
      const result = await service.call(
        AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE,
      );

      expect(result.requestId).toBeDefined();
      expect(typeof result.requestId).toBe('string');
      expect(result.requestId.length).toBeGreaterThan(0);
    });

    it('should pass body for POST requests', async () => {
      const requestBody = { username: 'test', password: 'pass123', role: 'default' };

      await service.call(AnythingLLMAdminEndpointIds.CREATE_USER, {
        body: requestBody,
      });

      expect(mockClientService.callAnythingLLM).toHaveBeenCalledWith(
        '/v1/admin/users/new',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody),
        }),
      );
    });
  });

  describe('getEndpoint', () => {
    it('should return endpoint definition for valid ID', () => {
      const endpoint = service.getEndpoint(
        AnythingLLMAdminEndpointIds.IS_MULTI_USER_MODE,
      );

      expect(endpoint).toBeDefined();
      expect(endpoint?.method).toBe('GET');
      expect(endpoint?.path).toBe('/v1/admin/is-multi-user-mode');
    });

    it('should return undefined for invalid ID', () => {
      const endpoint = service.getEndpoint('invalid.endpoint');

      expect(endpoint).toBeUndefined();
    });
  });
});
