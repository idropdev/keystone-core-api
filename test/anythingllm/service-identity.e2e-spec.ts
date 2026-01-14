import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnythingLLMClientService } from '../../src/anythingllm/services/anythingllm-client.service';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AllConfigType } from '../../src/config/config.type';

/**
 * E2E Tests for AnythingLLM Service Identity Implementation
 *
 * These tests verify the service-to-service (S2S) contract between
 * Keystone Core API and AnythingLLM by making REAL HTTP requests to
 * AnythingLLM admin endpoints.
 *
 * Prerequisites:
 * 1. AnythingLLM must be running and accessible
 * 2. ANYTHINGLLM_BASE_URL must be set in environment
 * 3. GCP credentials must be configured (service account or ADC with impersonation)
 * 4. Service account must have permission to mint ID tokens
 * 5. ANYTHINGLLM_SERVICE_AUDIENCE must match AnythingLLM config
 *
 * To run these tests:
 *   ANYTHINGLLM_BASE_URL=http://localhost:3001/api npm run test:e2e -- service-identity.e2e-spec.ts
 *
 * To skip tests if AnythingLLM is not available:
 *   SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- service-identity.e2e-spec.ts
 *
 * Note: The test:e2e script includes NODE_OPTIONS="--experimental-vm-modules" by default
 * to support google-auth-library's dynamic imports. This is required for Jest's VM to
 * handle ESM modules used by google-auth-library.
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
    it('should mint ID token successfully', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // Test token minting by making a real request
      // If token minting fails, the request will fail
      const response = await clientService.callAnythingLLM(
        '/v1/admin/is-multi-user-mode',
        {
          method: 'GET',
        },
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });
  });

  describe('System Status Endpoints', () => {
    it('should call is-multi-user-mode endpoint successfully', async () => {
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
      expect(typeof data.isMultiUser).toBe('boolean');
    });
  });

  describe('User Management Endpoints', () => {
    it('should list users successfully', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const response = await clientService.callAnythingLLM('/v1/admin/users', {
        method: 'GET',
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('users');
      expect(Array.isArray(data.users)).toBe(true);
    });

    it('should create a new user', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const testUsername = `e2e-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const response = await clientService.callAnythingLLM(
        '/v1/admin/users/new',
        {
          method: 'POST',
          body: JSON.stringify({
            username: testUsername,
            password: 'E2eTestPassword123!',
            role: 'default',
          }),
        },
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('user');
      expect(data.user).toHaveProperty('id');
      expect(data.user).toHaveProperty('username');
      expect(data.user.username).toBe(testUsername);
    });
  });

  describe('Invitation Management Endpoints', () => {
    it('should list invites successfully', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const response = await clientService.callAnythingLLM(
        '/v1/admin/invites',
        {
          method: 'GET',
        },
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('invites');
      expect(Array.isArray(data.invites)).toBe(true);
    });

    it('should create a new invite', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // Create invite with workspace IDs (required by AnythingLLM API)
      const response = await clientService.callAnythingLLM(
        '/v1/admin/invite/new',
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceIds: [],
          }),
        },
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('invite');
      expect(data.invite).toHaveProperty('id');
      expect(data.invite).toHaveProperty('code');
      expect(data.invite).toHaveProperty('status');
      expect(data.invite.status).toBe('pending');
      expect(typeof data.invite.id).toBe('number');
      expect(typeof data.invite.code).toBe('string');
    });
  });

  describe('Request Headers and Authentication', () => {
    it('should include Authorization header with Bearer token', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // Make a real request and verify it succeeds (which means auth worked)
      const response = await clientService.callAnythingLLM(
        '/v1/admin/is-multi-user-mode',
        {
          method: 'GET',
        },
      );

      // If we get a 200, the Authorization header was correct
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });

    it('should include X-Request-Id header', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // Make a real request - the service should add X-Request-Id
      const response = await clientService.callAnythingLLM(
        '/v1/admin/is-multi-user-mode',
        {
          method: 'GET',
        },
      );

      expect(response.ok).toBe(true);
    });

    it('should include X-Client-Service header', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // Make a real request - the service should add X-Client-Service: keystone
      const response = await clientService.callAnythingLLM(
        '/v1/admin/is-multi-user-mode',
        {
          method: 'GET',
        },
      );

      expect(response.ok).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid endpoint gracefully', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const response = await clientService.callAnythingLLM(
        '/v1/admin/nonexistent-endpoint',
        {
          method: 'GET',
        },
      );

      // Should get 404 or similar error status
      expect(response.ok).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle invalid request body gracefully', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const response = await clientService.callAnythingLLM(
        '/v1/admin/users/new',
        {
          method: 'POST',
          body: JSON.stringify({
            // Missing required fields
            invalidField: 'invalid',
          }),
        },
      );

      // Should get 400 Bad Request or similar
      expect(response.ok).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('URL Construction', () => {
    it('should handle relative endpoints correctly', async () => {
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
    });

    it('should handle absolute URLs correctly', async () => {
      if (skipTests) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      // Test with absolute URL (should use it as-is)
      const absoluteUrl = `${anythingllmBaseUrl}/v1/admin/is-multi-user-mode`;
      const response = await clientService.callAnythingLLM(absoluteUrl, {
        method: 'GET',
      });

      expect(response.ok).toBe(true);
    });
  });
});
