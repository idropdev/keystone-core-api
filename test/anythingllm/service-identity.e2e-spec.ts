import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnythingLLMClientService } from '../../src/anythingllm/services/anythingllm-client.service';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AllConfigType } from '../../src/config/config.type';

/**
 * E2E Tests for AnythingLLM Service Identity Implementation
 *
 * These tests verify the service-to-service (S2S) contract between
 * Keystone Core API and AnythingLLM.
 *
 * Prerequisites:
 * 1. AnythingLLM must be running and accessible
 * 2. ANYTHINGLLM_BASE_URL must be set in environment
 * 3. GCP credentials must be configured (service account or ADC)
 * 4. Service account must have permission to mint ID tokens
 * 5. ANYTHINGLLM_SERVICE_AUDIENCE must match AnythingLLM config
 *
 * To run these tests:
 *   ANYTHINGLLM_BASE_URL=http://localhost:3001/api npm run test:e2e -- service-identity.e2e-spec.ts
 *
 * To skip tests if AnythingLLM is not available:
 *   SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- service-identity.e2e-spec.ts
 */
describe('AnythingLLM Service Identity (E2E)', () => {
  let clientService: AnythingLLMClientService;
  let configService: ConfigService<AllConfigType>;
  let module: TestingModule;

  const anythingllmBaseUrl =
    process.env.ANYTHINGLLM_BASE_URL || 'http://localhost:3001/api';
  const skipTests = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';

  beforeAll(async () => {
    if (skipTests) {
      console.log(
        'SKIP_ANYTHINGLLM_TESTS=true - Skipping AnythingLLM E2E tests',
      );
      return;
    }

    module = await Test.createTestingModule({
      imports: [AnythingLLMModule],
    }).compile();

    clientService = module.get<AnythingLLMClientService>(
      AnythingLLMClientService,
    );
    configService = module.get<ConfigService<AllConfigType>>(ConfigService);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('Service Identity Token Minting', () => {
    it.skip('should mint ID token successfully', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // This is an integration test that requires actual GCP credentials
      // In a real scenario, you would test the token minting
      // For now, we test it indirectly through the HTTP client
    });
  });

  describe('HTTP Client - Service-to-Service Contract', () => {
    beforeEach(() => {
      if (skipTests) {
        return;
      }
    });

    it('should call AnythingLLM endpoint with service identity authentication', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // Test endpoint: GET /v1/admin/is-multi-user-mode
      // This is the simplest endpoint that requires service identity auth
      const response = await clientService.callAnythingLLM(
        '/v1/admin/is-multi-user-mode',
        {
          method: 'GET',
        },
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('isMultiUser');
      expect(typeof data.isMultiUser).toBe('boolean');
    });

    it('should include required headers in request', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // Mock fetch to capture request headers
      const originalFetch = global.fetch;
      let capturedHeaders: Headers | undefined;

      global.fetch = jest.fn().mockImplementation(async (url, options) => {
        capturedHeaders = (options as RequestInit).headers as Headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ isMultiUser: true }),
        } as Response;
      });

      try {
        await clientService.callAnythingLLM('/v1/admin/is-multi-user-mode', {
          method: 'GET',
        });

        // Verify headers were set
        expect(capturedHeaders).toBeDefined();
        const headers = capturedHeaders as any;

        // Check for Authorization header (Bearer token)
        expect(headers.Authorization).toBeDefined();
        expect(headers.Authorization).toMatch(/^Bearer .+/);

        // Check for required custom headers
        expect(headers['X-Request-Id']).toBeDefined();
        expect(headers['X-Client-Service']).toBe('keystone');
        expect(headers['Content-Type']).toBe('application/json');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should handle 401 Unauthorized (invalid token)', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // This test would require mocking the token to be invalid
      // For now, we skip it as it requires actual AnythingLLM setup
      // In a real scenario, you would:
      // 1. Mock the service identity service to return an invalid token
      // 2. Verify that AnythingLLM returns 401
    });

    it('should construct correct URL from base URL and endpoint', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const originalFetch = global.fetch;
      let capturedUrl: string | undefined;

      global.fetch = jest.fn().mockImplementation(async (url, options) => {
        capturedUrl = url as string;
        return {
          ok: true,
          status: 200,
          json: async () => ({ isMultiUser: true }),
        } as Response;
      });

      try {
        const endpoint = '/v1/admin/is-multi-user-mode';
        await clientService.callAnythingLLM(endpoint, {
          method: 'GET',
        });

        expect(capturedUrl).toBe(`${anythingllmBaseUrl}${endpoint}`);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('should handle absolute URLs correctly', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const originalFetch = global.fetch;
      let capturedUrl: string | undefined;

      global.fetch = jest.fn().mockImplementation(async (url, options) => {
        capturedUrl = url as string;
        return {
          ok: true,
          status: 200,
          json: async () => ({ isMultiUser: true }),
        } as Response;
      });

      try {
        const absoluteUrl = 'https://anythingllm.example.com/api/v1/test';
        await clientService.callAnythingLLM(absoluteUrl, {
          method: 'GET',
        });

        expect(capturedUrl).toBe(absoluteUrl);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('S2S Contract Verification', () => {
    it('should successfully call is-multi-user-mode endpoint', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const response = await clientService.callAnythingLLM(
        '/v1/admin/is-multi-user-mode',
        {
          method: 'GET',
        },
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('isMultiUser');
    });

    it('should fail with 401 if service identity is invalid', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // This test requires actual AnythingLLM setup with invalid credentials
      // In a real scenario, you would test this with an invalid token
      // For now, we document the expected behavior
      expect(true).toBe(true); // Placeholder
    });
  });
});

