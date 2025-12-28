import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnythingLLMClientService } from './anythingllm-client.service';
import { AnythingLLMServiceIdentityService } from './anythingllm-service-identity.service';
import { AllConfigType } from '../../config/config.type';

// Mock global fetch
global.fetch = jest.fn();

describe('AnythingLLMClientService', () => {
  let service: AnythingLLMClientService;
  let mockServiceIdentityService: jest.Mocked<AnythingLLMServiceIdentityService>;
  let mockConfigService: jest.Mocked<ConfigService<AllConfigType>>;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(async () => {
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

    // Create mock service identity service
    mockServiceIdentityService = {
      getIdToken: jest.fn(),
    } as any;

    // Create mock ConfigService
    mockConfigService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMClientService,
        {
          provide: AnythingLLMServiceIdentityService,
          useValue: mockServiceIdentityService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMClientService>(
      AnythingLLMClientService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('callAnythingLLM', () => {
    const mockToken = 'mock-id-token';
    const mockBaseUrl = 'http://localhost:3001/api';
    const mockEndpoint = '/v1/admin/is-multi-user-mode';
    const mockResponseBody = { isMultiUser: true };

    beforeEach(() => {
      mockServiceIdentityService.getIdToken.mockResolvedValue(mockToken);
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'anythingllm.baseUrl') return mockBaseUrl;
        return undefined;
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockResponseBody),
        text: jest.fn(),
        headers: new Headers(),
      } as any);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should call AnythingLLM API with service identity token', async () => {
      await service.callAnythingLLM(mockEndpoint);

      expect(mockServiceIdentityService.getIdToken).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();

      const fetchCall = mockFetch.mock.calls[0];
      const url = fetchCall[0];
      const options = fetchCall[1] as RequestInit;

      expect(url).toBe(`${mockBaseUrl}${mockEndpoint}`);
      expect(options.headers).toBeDefined();
      expect((options.headers as any).Authorization).toBe(`Bearer ${mockToken}`);
    });

    it('should add required headers', async () => {
      await service.callAnythingLLM(mockEndpoint);

      const fetchCall = mockFetch.mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      const headers = options.headers as any;

      expect(headers.Authorization).toBe(`Bearer ${mockToken}`);
      expect(headers['X-Request-Id']).toBeDefined();
      expect(headers['X-Client-Service']).toBe('keystone');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should generate unique request IDs', async () => {
      await service.callAnythingLLM(mockEndpoint);
      const requestId1 = (mockFetch.mock.calls[0][1] as any).headers[
        'X-Request-Id'
      ];

      await service.callAnythingLLM(mockEndpoint);
      const requestId2 = (mockFetch.mock.calls[1][1] as any).headers[
        'X-Request-Id'
      ];

      expect(requestId1).toBeDefined();
      expect(requestId2).toBeDefined();
      expect(requestId1).not.toBe(requestId2);
    });

    it('should preserve existing headers from options', async () => {
      const customHeaders = {
        'X-Custom-Header': 'custom-value',
      };

      await service.callAnythingLLM(mockEndpoint, {
        headers: customHeaders,
      });

      const fetchCall = mockFetch.mock.calls[0];
      const options = fetchCall[1] as RequestInit;
      const headers = options.headers as any;

      expect(headers['X-Custom-Header']).toBe('custom-value');
      expect(headers.Authorization).toBe(`Bearer ${mockToken}`);
    });

    it('should handle relative endpoints', async () => {
      await service.callAnythingLLM('v1/admin/test');

      const fetchCall = mockFetch.mock.calls[0];
      const url = fetchCall[0];

      expect(url).toBe(`${mockBaseUrl}/v1/admin/test`);
    });

    it('should handle absolute URLs', async () => {
      const absoluteUrl = 'https://anythingllm.example.com/api/v1/test';

      await service.callAnythingLLM(absoluteUrl);

      const fetchCall = mockFetch.mock.calls[0];
      const url = fetchCall[0];

      expect(url).toBe(absoluteUrl);
    });

    it('should pass through fetch options', async () => {
      const method = 'POST';
      const body = JSON.stringify({ test: 'data' });

      await service.callAnythingLLM(mockEndpoint, {
        method,
        body,
      });

      const fetchCall = mockFetch.mock.calls[0];
      const options = fetchCall[1] as RequestInit;

      expect(options.method).toBe(method);
      expect(options.body).toBe(body);
    });

    it('should throw error if token minting fails', async () => {
      const errorMessage = 'Token minting failed';
      mockServiceIdentityService.getIdToken.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        service.callAnythingLLM(mockEndpoint),
      ).rejects.toThrow(`Failed to mint service identity token: ${errorMessage}`);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return fetch Response', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockResponseBody),
      } as any;

      mockFetch.mockResolvedValue(mockResponse);

      const response = await service.callAnythingLLM(mockEndpoint);

      expect(response).toBe(mockResponse);
    });
  });
});

