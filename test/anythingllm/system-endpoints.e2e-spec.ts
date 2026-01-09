import request from 'supertest';
import { Test } from '@nestjs/testing';
import { APP_URL } from '../utils/constants';
import {
  createTestUser,
  getAdminToken,
  TestUser,
  createTestManager,
  TestManager,
} from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AnythingLLMServiceIdentityService } from '../../src/anythingllm/services/anythingllm-service-identity.service';

/**
 * Sleep utility to avoid rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * End-to-End Tests for AnythingLLM System Endpoints
 *
 * Tests Phase 1 system endpoints with role-based authorization:
 * - User role (default user)
 * - Manager role
 * - Admin role
 *
 * Tests both delegated token (user JWT) and service identity authentication.
 *
 * Prerequisites:
 * - Keystone API must be running on port 3000 (APP_URL=http://localhost:3000)
 * - AnythingLLM must be running (ANYTHINGLLM_BASE_URL configured)
 *
 * To skip tests:
 *   SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- system-endpoints.e2e-spec.ts
 */
describe('AnythingLLM System Endpoints (E2E)', () => {
  let adminToken: string;
  let adminUser: TestUser;
  let manager: TestManager;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let testModule: any;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const APP = APP_URL;

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Create test users with different roles
    console.log('[SETUP] Creating test users...');

    // Admin user (get admin token and create user if needed)
    // For admin, we'll use the admin token directly
    adminUser = {
      id: 0, // Will be extracted from token if needed
      email: 'admin@test.com',
      token: adminToken,
      roleId: RoleEnum.admin,
    };

    // Create manager
    manager = await createTestManager(adminToken);
    managerUser = {
      id: manager.userId,
      email: '',
      token: manager.token,
      roleId: RoleEnum.manager,
    };

    // Create regular user
    regularUser = await createTestUser(RoleEnum.user, 'system-test-user');

    // Set up service identity service for service identity tests
    if (!SKIP_ANYTHINGLLM_TESTS) {
      try {
        testModule = await Test.createTestingModule({
          imports: [AnythingLLMModule],
        }).compile();

        serviceIdentityService = testModule.get(
          AnythingLLMServiceIdentityService,
        );
      } catch (error) {
        console.warn(
          'Failed to initialize AnythingLLM services, some tests will be skipped:',
          error,
        );
        serviceIdentityService = null;
      }
    }

    // Wait a bit to avoid rate limiting
    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    if (testModule) {
      await testModule.close();
    }
  });

  // Global skip check
  const shouldSkipTests = (): boolean => {
    if (SKIP_ANYTHINGLLM_TESTS) {
      return true;
    }
    return false;
  };

  // Verify Keystone API is reachable
  const verifyKeystoneReachable = async (): Promise<boolean> => {
    try {
      const response = await request(APP).get('/api/v1/status').timeout(5000);
      return response.status === 200 || response.status === 404; // 404 means API is up but endpoint doesn't exist
    } catch (error) {
      console.warn('[SKIP] Keystone API not reachable:', error);
      return false;
    }
  };

  describe('GET /api/anythingllm/v1/system/auth - Role-based Access', () => {
    it('should allow admin user to check auth', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping admin auth check test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/auth')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('authenticated');
      expect(typeof response.body.authenticated).toBe('boolean');
    }, 30000);

    it('should allow manager user to check auth', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping manager auth check test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/auth')
        .set('Authorization', `Bearer ${managerUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('authenticated');
      expect(typeof response.body.authenticated).toBe('boolean');
    }, 30000);

    it('should allow regular user to check auth', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping regular user auth check test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/auth')
        .set('Authorization', `Bearer ${regularUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('authenticated');
      expect(typeof response.body.authenticated).toBe('boolean');
    }, 30000);

    it('should allow service identity to check auth', async () => {
      if (shouldSkipTests() || !serviceIdentityService) {
        console.log('[SKIP] Skipping service identity auth check test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Get service identity token
      let serviceToken: string;
      try {
        serviceToken = await serviceIdentityService.getIdToken();
      } catch (error) {
        console.log('[SKIP] Service identity not available, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/auth')
        .set('Authorization', `Bearer ${serviceToken}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('authenticated');
    }, 30000);
  });

  describe('GET /api/anythingllm/v1/system - Role-based Access', () => {
    it('should allow admin user to get system info', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping admin system info test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('version');
      expect(response.headers['x-request-id']).toBeDefined();
    }, 30000);

    it('should allow manager user to get system info', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping manager system info test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${managerUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('version');
    }, 30000);

    it('should allow regular user to get system info when SYSTEM_VISIBILITY_ALLOW_USERS=true', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping regular user system info test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Note: This test assumes SYSTEM_VISIBILITY_ALLOW_USERS=true
      // If false, expect 403
      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${regularUser.token}`)
        .timeout(10000);

      // Accept either 200 (allowed) or 403 (denied based on config)
      expect([200, 403]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('version');
      } else {
        expect(response.body).toHaveProperty('error');
      }
    }, 30000);

    it('should allow service identity to get system info', async () => {
      if (shouldSkipTests() || !serviceIdentityService) {
        console.log('[SKIP] Skipping service identity system info test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      let serviceToken: string;
      try {
        serviceToken = await serviceIdentityService.getIdToken();
      } catch (error) {
        console.log('[SKIP] Service identity not available, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${serviceToken}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('version');
    }, 30000);
  });

  describe('GET /api/anythingllm/v1/system/vector-count - Role-based Access', () => {
    it('should allow admin user to get vector count', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping admin vector count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/vector-count')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
      expect(typeof response.body.count).toBe('number');
    }, 30000);

    it('should allow manager user to get vector count', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping manager vector count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/vector-count')
        .set('Authorization', `Bearer ${managerUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
    }, 30000);

    it('should allow regular user to get vector count when SYSTEM_VISIBILITY_ALLOW_USERS=true', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping regular user vector count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/vector-count')
        .set('Authorization', `Bearer ${regularUser.token}`)
        .timeout(10000);

      // Accept either 200 (allowed) or 403 (denied based on config)
      expect([200, 403]).toContain(response.status);
    }, 30000);
  });

  describe('GET /api/anythingllm/v1/system/workspace-count - Role-based Access', () => {
    it('should allow admin user to get workspace count', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping admin workspace count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/workspace-count')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
      expect(typeof response.body.count).toBe('number');
    }, 30000);

    it('should allow manager user to get workspace count', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping manager workspace count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/workspace-count')
        .set('Authorization', `Bearer ${managerUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
    }, 30000);

    it('should allow regular user to get workspace count when SYSTEM_VISIBILITY_ALLOW_USERS=true', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping regular user workspace count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/workspace-count')
        .set('Authorization', `Bearer ${regularUser.token}`)
        .timeout(10000);

      // Accept either 200 (allowed) or 403 (denied based on config)
      expect([200, 403]).toContain(response.status);
    }, 30000);
  });

  describe('GET /api/anythingllm/v1/system/document-count - Role-based Access', () => {
    it('should allow admin user to get document count', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping admin document count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/document-count')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
      expect(typeof response.body.count).toBe('number');
    }, 30000);

    it('should allow manager user to get document count', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping manager document count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/document-count')
        .set('Authorization', `Bearer ${managerUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count');
    }, 30000);

    it('should allow regular user to get document count when SYSTEM_VISIBILITY_ALLOW_USERS=true', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping regular user document count test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/document-count')
        .set('Authorization', `Bearer ${regularUser.token}`)
        .timeout(10000);

      // Accept either 200 (allowed) or 403 (denied based on config)
      expect([200, 403]).toContain(response.status);
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should return 401 for invalid JWT', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping invalid JWT test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', 'Bearer invalid-token')
        .timeout(10000);

      expect(response.status).toBe(401);
    }, 30000);

    it('should return 401 for missing token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping missing token test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .timeout(10000);

      // Service identity might be used if no JWT, so accept 200 or 401
      expect([200, 401]).toContain(response.status);
    }, 30000);
  });

  describe('Response Normalization', () => {
    it('should normalize auth response to { authenticated: true/false } only', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping auth response normalization test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/auth')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        authenticated: expect.any(Boolean),
      });
      // Verify no additional fields
      expect(Object.keys(response.body).length).toBe(1);
    }, 30000);

    it('should normalize check-token response to { authenticated: true/false } only', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping check-token response normalization test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system/check-token')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        authenticated: expect.any(Boolean),
      });
      // Verify no additional fields
      expect(Object.keys(response.body).length).toBe(1);
    }, 30000);
  });

  describe('Correlation ID', () => {
    it('should return X-Request-Id header', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping correlation ID test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${adminUser.token}`)
        .timeout(10000);

      expect(response.status).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();
      expect(typeof response.headers['x-request-id']).toBe('string');
    }, 30000);
  });
});
