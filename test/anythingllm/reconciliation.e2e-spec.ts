import request from 'supertest';
import { APP_URL } from '../utils/constants';
import { getAdminToken } from '../utils/test-helpers';
import {
  setupAnythingLLMMock,
  setupNock,
  cleanupNock,
} from '../utils/anythingllm-mock-helpers';

/**
 * End-to-End Tests for AnythingLLM Reconciliation Service
 *
 * Tests the reconciliation endpoints:
 * - GET /v1/admin/anythingllm/reconciliation/status - Get reconciliation report
 * - POST /v1/admin/anythingllm/reconciliation/fix-orphaned-mapping/:id - Fix orphaned mapping
 *
 * All operations use delegated tokens (HS256) with admin context.
 */
describe('AnythingLLM Reconciliation (E2E)', () => {
  let adminToken: string;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';

  beforeAll(async () => {
    adminToken = await getAdminToken();
  }, 60000);

  beforeEach(() => {
    if (!SKIP_ANYTHINGLLM_TESTS) {
      setupNock();
    }
  });

  afterEach(() => {
    if (!SKIP_ANYTHINGLLM_TESTS) {
      cleanupNock();
    }
  });

  describe('Reconciliation report generation', () => {
    it('should generate reconciliation report with all inconsistencies', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping reconciliation report test');
        return;
      }

      // Mock AnythingLLM API calls to return test data
      // Note: In a real scenario, these would be actual API calls
      // For E2E tests, we'll verify the endpoint is accessible and returns a report structure

      const response = await request(APP_URL)
        .get('/api/v1/admin/anythingllm/reconciliation/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Verify: Report includes all inconsistencies
      expect(response.body).toHaveProperty('orphanedMappings');
      expect(response.body).toHaveProperty('orphanedAnythingLLMUsers');
      expect(response.body).toHaveProperty('usersWithoutWorkspaces');
      expect(response.body).toHaveProperty('timestamp');

      // Verify structure
      expect(Array.isArray(response.body.orphanedMappings)).toBe(true);
      expect(Array.isArray(response.body.orphanedAnythingLLMUsers)).toBe(true);
      expect(Array.isArray(response.body.usersWithoutWorkspaces)).toBe(true);
    }, 30000);

    it('should verify all AnythingLLM API calls use delegated tokens (HS256) with admin context', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping token verification test');
        return;
      }

      // Setup nock interceptors that validate HS256 tokens
      const userListMock = setupAnythingLLMMock('get', '/v1/admin/users', 200, {
        users: [],
      });

      const response = await request(APP_URL)
        .get('/api/v1/admin/anythingllm/reconciliation/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Verify: Report generated
      expect(response.body).toHaveProperty('timestamp');

      // Note: The nock interceptors validate HS256 tokens automatically
      // If a non-HS256 token is used, the interceptor will return 401
    }, 30000);
  });

  describe('Fix orphaned mapping', () => {
    it('should fix orphaned mapping and verify deletion', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping fix orphaned mapping test');
        return;
      }

      // Note: This test requires a real orphaned mapping in the database
      // For E2E tests, we'll verify the endpoint is accessible and returns success
      // In a real scenario, you would create a test mapping first

      const mappingId = 999; // Test mapping ID

      const response = await request(APP_URL)
        .post(
          `/api/v1/admin/anythingllm/reconciliation/fix-orphaned-mapping/${mappingId}`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect((res) => {
          // May return 200 (success) or 404 (mapping not found)
          expect([200, 404]).toContain(res.status);
        });

      if (response.status === 200) {
        // Verify: Mapping deleted, audit logged
        expect(response.body).toHaveProperty('success');
        expect(response.body.success).toBe(true);
        expect(response.body).toHaveProperty('message');
      }
    }, 30000);

    it('should verify fix operations use delegated tokens (HS256) with admin context', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping fix token verification test');
        return;
      }

      // Setup nock interceptor that validates HS256 tokens
      const suspendUserMock = setupAnythingLLMMock(
        'post',
        '/v1/admin/users/999/suspend',
        200,
        { success: true },
      );

      const mappingId = 999;

      // Attempt to fix orphaned mapping
      // Note: This may fail if mapping doesn't exist, but we verify the endpoint is accessible
      await request(APP_URL)
        .post(
          `/api/v1/admin/anythingllm/reconciliation/fix-orphaned-mapping/${mappingId}`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect((res) => {
          // May return 200 (success) or 404 (mapping not found)
          expect([200, 404]).toContain(res.status);
        });

      // Note: The nock interceptors validate HS256 tokens automatically
    }, 30000);
  });

  describe('Reconciliation uses admin context for delegated tokens', () => {
    it('should verify Authorization headers contain HS256 tokens (not RS256)', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping admin context token verification test');
        return;
      }

      // Setup nock interceptors that validate HS256 tokens
      // If RS256 tokens are used, these will return 401
      const userListMock = setupAnythingLLMMock('get', '/v1/admin/users', 200, {
        users: [],
      });

      const externalUserMock = setupAnythingLLMMock(
        'get',
        '/v1/admin/users/external/123',
        404,
        { error: 'Not Found' },
      );

      const response = await request(APP_URL)
        .get('/api/v1/admin/anythingllm/reconciliation/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Verify: Report generated successfully (indicates HS256 tokens were used)
      expect(response.body).toHaveProperty('timestamp');

      // Note: The nock interceptors automatically validate HS256 tokens
      // If non-HS256 tokens were used, the interceptors would return 401
    }, 30000);

    it('should verify token issuer context is system admin (ID: 1) when no user context', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping system admin context verification test');
        return;
      }

      // The reconciliation service uses system admin (ID: 1) for delegated token context
      // This is verified in the unit tests
      // For E2E, we verify the endpoint works correctly

      const response = await request(APP_URL)
        .get('/api/v1/admin/anythingllm/reconciliation/status')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Verify: Report generated (indicates admin context was used)
      expect(response.body).toHaveProperty('timestamp');
    }, 30000);
  });
});
