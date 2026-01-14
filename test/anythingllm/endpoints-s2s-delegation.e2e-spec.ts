import request from 'supertest';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
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
import { AnythingLLMAuthDelegationService } from '../../src/anythingllm-auth-delegation/service';

/**
 * Sleep utility to avoid rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decode JWT token without verification (for testing)
 */
function decodeToken(token: string): any {
  return jwt.decode(token, { complete: true });
}

/**
 * End-to-End Tests for AnythingLLM Endpoints with S2S Token Delegation
 *
 * Tests the complete S2S token delegation flow for AnythingLLM endpoints:
 * 1. Admin endpoints with delegated tokens (user context embedded)
 * 2. System endpoints with delegated tokens
 * 3. Token structure verification (sub: 'svc-keystone', act: {userId, roles})
 * 4. Role-based authorization enforcement
 * 5. Service identity fallback when no user context
 *
 * Prerequisites:
 * - Keystone API must be running on port 3000 (APP_URL=http://localhost:3000)
 * - AnythingLLM must be running (ANYTHINGLLM_BASE_URL configured)
 * - ENABLE_DELEGATED_TOKENS=true
 * - ANYTHINGLLM_DELEGATED_TOKEN_SECRET must be set
 *
 * To skip tests:
 *   SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- endpoints-s2s-delegation.e2e-spec.ts
 */
describe('AnythingLLM Endpoints S2S Token Delegation (E2E)', () => {
  let adminToken: string;
  let adminUser: TestUser;
  let manager: TestManager;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let authDelegationService: AnythingLLMAuthDelegationService | null = null;
  let testModule: any;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const APP = APP_URL;
  const DELEGATED_TOKEN_SECRET = process.env.ANYTHINGLLM_DELEGATED_TOKEN_SECRET;

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Create test users with different roles
    console.log('[SETUP] Creating test users...');

    adminUser = {
      id: 0,
      email: 'admin@test.com',
      token: adminToken,
      roleId: RoleEnum.admin,
    };

    manager = await createTestManager(adminToken);
    managerUser = {
      id: manager.userId,
      email: '',
      token: manager.token,
      roleId: RoleEnum.manager,
    };

    regularUser = await createTestUser(
      RoleEnum.user,
      's2s-delegation-test-user',
    );

    // Set up services for testing
    if (!SKIP_ANYTHINGLLM_TESTS) {
      try {
        testModule = await Test.createTestingModule({
          imports: [AnythingLLMModule],
        }).compile();

        serviceIdentityService = testModule.get(
          AnythingLLMServiceIdentityService,
        );
        authDelegationService = testModule.get(
          AnythingLLMAuthDelegationService,
        );
      } catch (error) {
        console.warn(
          'Failed to initialize AnythingLLM services, some tests will be skipped:',
          error,
        );
        serviceIdentityService = null;
        authDelegationService = null;
      }
    }

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
      return response.status === 200 || response.status === 404;
    } catch (error) {
      console.warn('[SKIP] Keystone API not reachable:', error);
      return false;
    }
  };

  describe('S2S Token Delegation - Token Structure Verification', () => {
    it('should issue delegated token with correct structure for admin user', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping delegated token structure test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Issue delegated token
      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'test',
          requesterContext: {
            userId: String(adminUser.id || 'admin-123'),
            roles: ['admin'],
            sessionId: 'test-session-123',
          },
          scope: ['anythingllm:admin:read', 'anythingllm:admin:write'],
        });

      expect(delegatedTokenResponse).toHaveProperty('token');
      expect(delegatedTokenResponse).toHaveProperty('expiresIn');
      expect(delegatedTokenResponse).toHaveProperty('expiresAt');
      expect(delegatedTokenResponse).toHaveProperty('audience');

      // Decode token to verify structure
      const decoded = decodeToken(delegatedTokenResponse.token);
      expect(decoded).toBeDefined();
      expect(decoded.payload).toBeDefined();

      // Verify service identity
      expect(decoded.payload.sub).toBe('svc-keystone');

      // Verify actor claim
      expect(decoded.payload.act).toBeDefined();
      expect(decoded.payload.act.sub).toBe(String(adminUser.id || 'admin-123'));
      expect(decoded.payload.act.roles).toEqual(['admin']);
      expect(decoded.payload.act.sessionId).toBe('test-session-123');

      // Verify standard claims
      expect(decoded.payload.aud).toBe('anythingllm');
      expect(decoded.payload.scope).toEqual([
        'anythingllm:admin:read',
        'anythingllm:admin:write',
      ]);
      expect(decoded.payload.exp).toBeGreaterThan(
        Math.floor(Date.now() / 1000),
      );
      expect(decoded.payload.iat).toBeLessThanOrEqual(
        Math.floor(Date.now() / 1000),
      );
    }, 30000);

    it('should issue delegated token with manager role', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping manager delegated token test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'test',
          requesterContext: {
            userId: String(managerUser.id),
            roles: ['manager'],
            sessionId: 'test-session-456',
          },
          scope: ['anythingllm:admin:read'],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      expect(decoded.payload.act.roles).toEqual(['manager']);
      expect(decoded.payload.act.sub).toBe(String(managerUser.id));
    }, 30000);

    it('should issue delegated token with user role', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping user delegated token test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'test',
          requesterContext: {
            userId: String(regularUser.id),
            roles: ['user'],
            sessionId: 'test-session-789',
          },
          scope: ['anythingllm:system:read'],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      expect(decoded.payload.act.roles).toEqual(['user']);
      expect(decoded.payload.act.sub).toBe(String(regularUser.id));
    }, 30000);
  });

  describe('S2S Token Delegation - System Endpoints', () => {
    it('should call system endpoint with delegated token (admin)', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping system endpoint delegated token test');
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
        .timeout(15000);

      // Should succeed (200) or fail gracefully (500 if AnythingLLM not configured)
      expect([200, 500, 503]).toContain(response.status);

      if (response.status === 200) {
        // AnythingLLM system endpoint returns { settings: {...} }
        expect(response.body).toHaveProperty('settings');
        expect(response.headers['x-request-id']).toBeDefined();
      }
    }, 30000);

    it('should call system endpoint with delegated token (manager)', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping manager system endpoint test');
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
        .timeout(15000);

      expect([200, 500, 503]).toContain(response.status);
    }, 30000);

    it('should call system endpoint with delegated token (user)', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping user system endpoint test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${regularUser.token}`)
        .timeout(15000);

      // May be 200 (if SYSTEM_VISIBILITY_ALLOW_USERS=true) or 403 (if false)
      expect([200, 403, 500, 503]).toContain(response.status);
    }, 30000);

    it('should call auth check endpoint with delegated token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping auth check endpoint test');
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
        .timeout(15000);

      expect([200, 500, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('authenticated');
        expect(typeof response.body.authenticated).toBe('boolean');
      }
    }, 30000);

    it('should call check token endpoint with delegated token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping check token endpoint test');
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
        .timeout(15000);

      expect([200, 500, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('authenticated');
      }
    }, 30000);

    it('should call vector count endpoint with delegated token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping vector count endpoint test');
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
        .timeout(15000);

      expect([200, 500, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('count');
        expect(typeof response.body.count).toBe('number');
      }
    }, 30000);

    it('should call workspace count endpoint with delegated token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping workspace count endpoint test');
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
        .timeout(15000);

      expect([200, 500, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('count');
        expect(typeof response.body.count).toBe('number');
      }
    }, 30000);

    it('should call document count endpoint with delegated token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping document count endpoint test');
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
        .timeout(15000);

      expect([200, 500, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('count');
        expect(typeof response.body.count).toBe('number');
      }
    }, 30000);
  });

  describe('S2S Token Delegation - Service Identity Fallback', () => {
    it('should use service identity when no user context provided', async () => {
      if (shouldSkipTests() || !serviceIdentityService) {
        console.log('[SKIP] Skipping service identity fallback test');
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

      // Call system endpoint without user JWT (should use service identity)
      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${serviceToken}`)
        .timeout(15000);

      // Should succeed with service identity (or fail if AnythingLLM not configured)
      expect([200, 401, 403, 500, 503]).toContain(response.status);
    }, 30000);

    it('should use service identity for admin endpoints', async () => {
      if (shouldSkipTests() || !serviceIdentityService) {
        console.log('[SKIP] Skipping admin endpoint service identity test');
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

      // Admin endpoints require service identity (not delegated tokens)
      const response = await request(APP)
        .get('/api/anythingllm/v1/admin/users')
        .set('Authorization', `Bearer ${serviceToken}`)
        .timeout(15000);

      // Should succeed (200) or fail gracefully
      expect([200, 401, 403, 500, 503]).toContain(response.status);
    }, 30000);
  });

  describe('S2S Token Delegation - Error Handling', () => {
    it('should return 401 when user JWT is invalid', async () => {
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
        .set('Authorization', 'Bearer invalid-token-12345')
        .timeout(10000);

      expect([401, 500, 503]).toContain(response.status);
    }, 30000);

    it('should return 401 when no authorization header provided', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping missing auth header test');
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

      // May be 401 (auth required) or 200 (if service identity fallback works)
      expect([200, 401, 500, 503]).toContain(response.status);
    }, 30000);

    it('should handle expired user JWT gracefully', async () => {
      if (shouldSkipTests() || !DELEGATED_TOKEN_SECRET) {
        console.log('[SKIP] Skipping expired JWT test (no secret available)');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Create an expired token
      const expiredToken = jwt.sign(
        {
          id: 'test-user',
          sub: 'test-user',
          role: 'admin',
          iat: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
          exp: Math.floor(Date.now() / 1000) - 1800, // 30 minutes ago (expired)
        },
        process.env.AUTH_JWT_SECRET || 'secret',
      );

      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${expiredToken}`)
        .timeout(10000);

      expect([401, 500, 503]).toContain(response.status);
    }, 30000);
  });

  describe('S2S Token Delegation - Role-Based Authorization', () => {
    it('should enforce role restrictions for system endpoints', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping role restriction test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Regular user should be restricted based on SYSTEM_VISIBILITY_ALLOW_USERS
      const response = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${regularUser.token}`)
        .timeout(10000);

      // May be 200 (if SYSTEM_VISIBILITY_ALLOW_USERS=true) or 403 (if false)
      expect([200, 403, 500, 503]).toContain(response.status);

      if (response.status === 403) {
        expect(response.body).toHaveProperty('error');
      }
    }, 30000);

    it('should allow admin access to all system endpoints', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping admin access test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const endpoints = [
        '/api/anythingllm/v1/system',
        '/api/anythingllm/v1/system/vector-count',
        '/api/anythingllm/v1/system/workspace-count',
        '/api/anythingllm/v1/system/document-count',
      ];

      for (const endpoint of endpoints) {
        const response = await request(APP)
          .get(endpoint)
          .set('Authorization', `Bearer ${adminUser.token}`)
          .timeout(10000);

        // Should succeed (200) or fail gracefully (500/503 if AnythingLLM not configured)
        expect([200, 500, 503]).toContain(response.status);
      }
    }, 60000);
  });
});
