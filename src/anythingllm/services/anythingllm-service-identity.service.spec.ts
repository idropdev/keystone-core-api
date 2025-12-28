import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import { AnythingLLMServiceIdentityService } from './anythingllm-service-identity.service';
import { AllConfigType } from '../../config/config.type';

// Mock google-auth-library
jest.mock('google-auth-library');

describe('AnythingLLMServiceIdentityService', () => {
  let service: AnythingLLMServiceIdentityService;
  let mockConfigService: jest.Mocked<ConfigService<AllConfigType>>;
  let mockGoogleAuth: jest.MockedClass<typeof GoogleAuth>;
  let mockIdTokenClient: {
    idTokenProvider: {
      fetchIdToken: jest.Mock;
    };
  };

  beforeEach(async () => {
    // Create mock ID token client
    mockIdTokenClient = {
      idTokenProvider: {
        fetchIdToken: jest.fn(),
      },
    };

    // Create mock GoogleAuth instance
    const mockAuthInstance = {
      getIdTokenClient: jest.fn().mockResolvedValue(mockIdTokenClient),
    } as unknown as GoogleAuth;

    // Mock GoogleAuth constructor
    mockGoogleAuth = GoogleAuth as jest.MockedClass<typeof GoogleAuth>;
    mockGoogleAuth.mockImplementation(() => mockAuthInstance);

    // Create mock ConfigService
    mockConfigService = {
      get: jest.fn(),
      getOrThrow: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnythingLLMServiceIdentityService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AnythingLLMServiceIdentityService>(
      AnythingLLMServiceIdentityService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getIdToken', () => {
    const mockToken = 'mock-id-token';
    const mockAudience = 'anythingllm-internal';

    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'anythingllm.serviceAuthMode') return 'gcp';
        if (key === 'anythingllm.serviceAudience') return mockAudience;
        return undefined;
      });
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue(
        mockToken,
      );
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should return ID token from GCP', async () => {
      const token = await service.getIdToken();

      expect(token).toBe(mockToken);
      expect(mockGoogleAuth).toHaveBeenCalled();
      expect(
        mockIdTokenClient.idTokenProvider.fetchIdToken,
      ).toHaveBeenCalledWith(mockAudience);
    });

    it('should use default audience if not configured', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'anythingllm.serviceAuthMode') return 'gcp';
        if (key === 'anythingllm.serviceAudience') return undefined;
        return undefined;
      });

      const token = await service.getIdToken();

      expect(token).toBe(mockToken);
      expect(
        mockIdTokenClient.idTokenProvider.fetchIdToken,
      ).toHaveBeenCalledWith('anythingllm-internal');
    });

    it('should cache tokens for 55 minutes', async () => {
      // First call
      const token1 = await service.getIdToken();
      expect(token1).toBe(mockToken);
      expect(
        mockIdTokenClient.idTokenProvider.fetchIdToken,
      ).toHaveBeenCalledTimes(1);

      // Second call (should use cache)
      const token2 = await service.getIdToken();
      expect(token2).toBe(mockToken);
      expect(
        mockIdTokenClient.idTokenProvider.fetchIdToken,
      ).toHaveBeenCalledTimes(1); // Still only called once

      // Verify same token returned
      expect(token1).toBe(token2);
    });

    it('should throw error if token minting fails', async () => {
      const errorMessage = 'Failed to fetch ID token';
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(service.getIdToken()).rejects.toThrow(
        `Failed to mint GCP ID token: ${errorMessage}`,
      );
    });

    it('should throw error if fetchIdToken returns null', async () => {
      mockIdTokenClient.idTokenProvider.fetchIdToken.mockResolvedValue(null);

      await expect(service.getIdToken()).rejects.toThrow(
        'Failed to mint GCP ID token: Failed to fetch ID token',
      );
    });

    it('should throw error for local_jwt mode (not implemented)', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'anythingllm.serviceAuthMode') return 'local_jwt';
        if (key === 'anythingllm.serviceAudience') return mockAudience;
        return undefined;
      });

      await expect(service.getIdToken()).rejects.toThrow(
        'Local JWT mode not yet implemented in Keystone',
      );
    });

    it('should refresh cache after expiration', async () => {
      // Mock Date.now to control cache expiration
      const originalNow = Date.now;
      let currentTime = originalNow();

      jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

      // First call
      const token1 = await service.getIdToken();
      expect(
        mockIdTokenClient.idTokenProvider.fetchIdToken,
      ).toHaveBeenCalledTimes(1);

      // Advance time by 56 minutes (past cache expiration)
      currentTime += 56 * 60 * 1000;

      // Second call (should fetch new token)
      const token2 = await service.getIdToken();
      expect(
        mockIdTokenClient.idTokenProvider.fetchIdToken,
      ).toHaveBeenCalledTimes(2);

      // Restore Date.now
      jest.spyOn(Date, 'now').mockRestore();
    });
  });
});

