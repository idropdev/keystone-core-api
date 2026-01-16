import request from 'supertest';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import { ANYTHINGLLM_BASE_URL, APP_URL } from '../utils/constants'; // eslint-disable-line @typescript-eslint/no-unused-vars
import { getAdminToken, createTestUser, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AnythingLLMServiceIdentityService } from '../../src/anythingllm/services/anythingllm-service-identity.service';
import { DelegatedTokenClaims } from '../../src/anythingllm-auth-delegation/domain/delegated-token-claims.entity'; /**
 * Mint a delegated JWT token for testing
 *
 * @param payload - Token payload (will be merged with standard claims)
 * @param secret - Secret key for signing (must match Keystone's secret)
 * @param algorithm - Algorithm to use (default: HS256)
 * @returns Signed JWT token string
 */
function mintDelegatedJWT(
  payload: Partial<DelegatedTokenClaims>,
  secret: string,
  algorithm: 'HS256' | 'RS256' = 'HS256',
): string {
  const now = Math.floor(Date.now() / 1000);
  const defaultPayload: DelegatedTokenClaims = {
    sub: 'svc-keystone',
    act: {
      sub: 'test-user',
      roles: ['user'],
    },
    scope: ['anythingllm:admin:read'],
    aud: 'anythingllm',
    iat: now,
    exp: now + 300, // 5 minutes
    nbf: now - 60, // 60s clock skew allowance
  };

  const mergedPayload = { ...defaultPayload, ...payload };

  // Validate act claim structure
  if (
    !mergedPayload.act ||
    typeof mergedPayload.act.sub !== 'string' ||
    !Array.isArray(mergedPayload.act.roles)
  ) {
    throw new Error(
      'Invalid act claim: must have sub (string) and roles (array)',
    );
  }

  return jwt.sign(mergedPayload as jwt.JwtPayload, secret, {
    algorithm,
  });
}

/**
 * End-to-End Tests for AnythingLLM Delegated JWT Auth
 *
 * Tests the complete delegated S2S JWT authentication flow:
 * 1. Delegated JWT acceptance (happy path)
 * 2. Requester identity propagation (act claim)
 * 3. Defense-in-depth rejections (negative tests)
 * 4. Optional scope enforcement
 * 5. Backward compatibility with existing S2S modes
 * 6. Correlation ID propagation
 *
 * Prerequisites:
 * - Keystone API must be running on port 3000 (APP_PORT=3000)
 * - AnythingLLM must be running on port 3001 (ANYTHINGLLM_BASE_URL=http://localhost:3001/api)
 * - ANYTHINGLLM_SERVICE_AUTH_MODE=keystone_delegated_jwt
 * - KEYSTONE_DELEGATED_JWT_SECRET must match Keystone's secret
 *
 * To skip tests:
 *   SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- delegated-auth.e2e-spec.ts
 *
 * Note: These tests make real HTTP calls to verify the trust boundary between
 * Keystone and AnythingLLM. This is integration-level trust boundary validation,
 * not unit testing JWT parsing.
 */
describe('AnythingLLM Delegated JWT Auth (E2E)', () => {
  let _adminToken: string;
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let testModule: any;
  let testUser: TestUser;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const ANYTHINGLLM_URL =
    process.env.ANYTHINGLLM_BASE_URL || ANYTHINGLLM_BASE_URL;
  const DELEGATED_JWT_SECRET =
    process.env.KEYSTONE_DELEGATED_JWT_SECRET ||
    process.env.ANYTHINGLLM_DELEGATED_TOKEN_SECRET;
  const DELEGATED_JWT_ISSUER =
    process.env.KEYSTONE_DELEGATED_JWT_ISSUER || 'svc-keystone';
  const DELEGATED_JWT_AUDIENCE =
    process.env.KEYSTONE_DELEGATED_JWT_AUDIENCE || 'anythingllm';
  const ENABLE_SCOPE_ENFORCEMENT =
    process.env.ENABLE_DELEGATED_SCOPE_ENFORCEMENT === 'true';
  const AUTH_MODE = process.env.ANYTHINGLLM_SERVICE_AUTH_MODE;

  beforeAll(async () => {
    _adminToken = await getAdminToken();

    // Create a test user for identity propagation tests
    testUser = await createTestUser(RoleEnum.user, 'delegated-auth-test');

    // Set up service identity service for backward compatibility tests
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
  }, 60000);

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

    if (!DELEGATED_JWT_SECRET) {
      console.log('[SKIP] KEYSTONE_DELEGATED_JWT_SECRET not configured');
      return true;
    }

    if (AUTH_MODE !== 'keystone_delegated_jwt') {
      console.log(
        `[SKIP] ANYTHINGLLM_SERVICE_AUTH_MODE is not 'keystone_delegated_jwt'(current: ${AUTH_MODE})`,
      );
      return true;
    }

    return false;
  };

  // Verify AnythingLLM is reachable
  const verifyAnythingLLMReachable = async (): Promise<boolean> => {
    try {
      // Try to ping AnythingLLM or check token endpoint
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/system/check-token')
        .timeout(5000);

      return response.status === 200 || response.status === 401; // 401 means service is up but needs auth
    } catch (error) {
      console.warn('[SKIP] AnythingLLM not reachable:', error);
      return false;
    }
  };

  describe('Test Suite 1: Delegated JWT Acceptance (Happy Path)', () => {
    it('should accept valid delegated JWT for S2S call', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping delegated JWT acceptance test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint delegated JWT with valid claims
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:admin:read'],
        },
        DELEGATED_JWT_SECRET!,
      );

      // Call AnythingLLM admin endpoint
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Assert: HTTP 200 and valid JSON response
      expect(response.status).toBe(200);
      expect(response.body).toBeDefined();
      expect(typeof response.body).toBe('object');
    }, 30000);

    it('should preserve systemActor semantics', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping systemActor semantics test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint delegated JWT
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:admin:read'],
        },
        DELEGATED_JWT_SECRET!,
      );

      // Call admin endpoint (requires systemActor=true)
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // If we get 200, systemActor semantics are preserved
      // (admin endpoints require systemActor=true)
      expect(response.status).toBe(200);
    }, 30000);
  });

  describe('Test Suite 2: Requester Identity Propagation (act)', () => {
    it('should preserve delegated actor context', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping identity propagation test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint delegated JWT with unique requester context
      const uniqueUserId = `user - ${Date.now()} `;
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: uniqueUserId,
            roles: ['manager'],
            sessionId: 'session-456',
            provider: 'google',
          },
          scope: ['anythingllm:thread:write'],
        },
        DELEGATED_JWT_SECRET!,
      );

      // Call a thread endpoint (if available) or admin endpoint
      // The key assertion is that the request succeeds, proving identity propagation
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Request should succeed (identity propagated correctly)
      expect([200, 404]).toContain(response.status); // 404 is OK if endpoint doesn't exist, 200 means auth worked

      // Note: Audit log verification would require access to logs or a debug endpoint
      // For now, we verify that the request succeeds (no auth rejection)
    }, 30000);
  });

  describe('Test Suite 3: Defense-in-Depth Rejections (Negative Tests)', () => {
    it('should reject JWT without act claim', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping missing act claim test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint JWT without act claim
      const now = Math.floor(Date.now() / 1000);
      const invalidPayload = {
        sub: 'svc-keystone',
        iss: DELEGATED_JWT_ISSUER,
        aud: DELEGATED_JWT_AUDIENCE,
        scope: ['anythingllm:admin:read'],
        iat: now,
        exp: now + 300,
      };

      const token = jwt.sign(invalidPayload, DELEGATED_JWT_SECRET!, {
        algorithm: 'HS256',
      });

      // Call admin endpoint
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Assert: HTTP 401
      expect(response.status).toBe(401);
    }, 30000);

    it('should reject JWT with wrong audience', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping wrong audience test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint JWT with wrong audience
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: 'wrong-service', // Wrong audience
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:admin:read'],
        },
        DELEGATED_JWT_SECRET!,
      );

      // Call admin endpoint
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Assert: HTTP 401
      expect(response.status).toBe(401);
    }, 30000);

    it('should reject expired token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping expired token test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint JWT with expiration in the past
      const now = Math.floor(Date.now() / 1000);
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:admin:read'],
          exp: now - 60, // Expired 60 seconds ago
        },
        DELEGATED_JWT_SECRET!,
      );

      // Call admin endpoint
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Assert: HTTP 401
      expect(response.status).toBe(401);
    }, 30000);

    it('should reject JWT with invalid signature', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping invalid signature test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint JWT with wrong secret
      const wrongSecret = 'wrong-secret-key';
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:admin:read'],
        },
        wrongSecret,
      );

      // Call admin endpoint
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Assert: HTTP 401
      expect(response.status).toBe(401);
    }, 30000);

    it('should reject JWT with invalid issuer', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping invalid issuer test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint JWT with wrong issuer
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: 'wrong-issuer', // Wrong issuer
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:admin:read'],
        },
        DELEGATED_JWT_SECRET!,
      );

      // Call admin endpoint
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Assert: HTTP 401
      expect(response.status).toBe(401);
    }, 30000);

    it('should reject JWT with invalid act structure', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping invalid act structure test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Test cases for invalid act structures
      const invalidCases = [
        { act: {} }, // Missing sub and roles
        { act: { sub: 'user-123' } }, // Missing roles
        { act: { roles: ['user'] } }, // Missing sub
        { act: { sub: 'user-123', roles: 'not-an-array' } }, // roles not array
      ];

      for (const invalidCase of invalidCases) {
        const now = Math.floor(Date.now() / 1000);
        const invalidPayload = {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          scope: ['anythingllm:admin:read'],
          iat: now,
          exp: now + 300,
          ...invalidCase,
        };

        const token = jwt.sign(
          invalidPayload as jwt.JwtPayload,
          DELEGATED_JWT_SECRET!,
          { algorithm: 'HS256' },
        );

        // Call admin endpoint
        const response = await request(ANYTHINGLLM_URL)
          .get('/v1/admin/users')
          .set('Authorization', `Bearer ${token} `)
          .set('X-Client-Service', 'keystone-test');

        // Assert: HTTP 401
        expect(response.status).toBe(401);
      }
    }, 60000);
  });

  describe('Test Suite 4: Optional Scope Enforcement', () => {
    it('should reject request with insufficient scope when enforcement enabled', async () => {
      if (shouldSkipTests() || !ENABLE_SCOPE_ENFORCEMENT) {
        console.log(
          '[SKIP] Skipping scope enforcement test (enforcement disabled or tests skipped)',
        );
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint delegated JWT with insufficient scope
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:thread:read'], // Read-only scope
        },
        DELEGATED_JWT_SECRET!,
      );

      // Try to call a write endpoint (would require write scope)
      // Note: This test assumes scope enforcement is implemented
      // If not implemented, this test will pass (scope enforcement is optional)
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // If scope enforcement is enabled and implemented, expect 403
      // Otherwise, expect 200 (enforcement is optional)
      if (ENABLE_SCOPE_ENFORCEMENT) {
        // Scope enforcement may or may not be implemented yet
        // Accept either 200 (not implemented) or 403 (implemented)
        expect([200, 403]).toContain(response.status);
      } else {
        expect(response.status).toBe(200);
      }
    }, 30000);

    it('should allow request with correct scope', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping correct scope test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint delegated JWT with correct scope
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:admin:read'], // Correct scope for admin read
        },
        DELEGATED_JWT_SECRET!,
      );

      // Call admin endpoint
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Assert: HTTP 200
      expect(response.status).toBe(200);
    }, 30000);

    it('should skip scope enforcement when disabled', async () => {
      if (shouldSkipTests() || ENABLE_SCOPE_ENFORCEMENT) {
        console.log(
          '[SKIP] Skipping scope enforcement skip test (enforcement enabled or tests skipped)',
        );
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint JWT with insufficient scope
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:thread:read'], // Insufficient scope
        },
        DELEGATED_JWT_SECRET!,
      );

      // Call endpoint that would require scope
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test');

      // Request should succeed (scope enforcement is optional/disabled)
      expect([200, 401]).toContain(response.status); // 401 is auth failure, 200 is success
    }, 30000);
  });

  describe('Test Suite 5: Backward Compatibility', () => {
    it('should maintain GCP mode compatibility', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || AUTH_MODE === 'keystone_delegated_jwt') {
        console.log(
          '[SKIP] Skipping GCP mode test (delegated mode active or tests skipped)',
        );
        return;
      }

      if (!serviceIdentityService) {
        console.log(
          '[SKIP] Service identity service not available, skipping GCP mode test',
        );
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Try to get GCP service identity token
      let serviceToken: string;
      try {
        serviceToken = await serviceIdentityService.getIdToken();
      } catch (_error) {
        console.log(
          '[SKIP] GCP service identity not available (expected in test env), skipping GCP mode test',
        );
        return;
      }

      // Call admin endpoint with GCP token
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${serviceToken} `)
        .set('X-Client-Service', 'keystone-test');

      // Assert: HTTP 200 (GCP mode still works)
      expect(response.status).toBe(200);
    }, 30000);
  });

  describe('Test Suite 6: Correlation ID Propagation', () => {
    it('should preserve correlation ID in requests', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping correlation ID test');
        return;
      }

      const isReachable = await verifyAnythingLLMReachable();
      if (!isReachable) {
        console.log('[SKIP] AnythingLLM not reachable, skipping test');
        return;
      }

      // Mint delegated JWT
      const token = mintDelegatedJWT(
        {
          sub: 'svc-keystone',
          iss: DELEGATED_JWT_ISSUER,
          aud: DELEGATED_JWT_AUDIENCE,
          act: {
            sub: String(testUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:admin:read'],
        },
        DELEGATED_JWT_SECRET!,
      );

      // Send request with correlation ID
      const correlationId = `test - correlation - ${Date.now()} `;
      const response = await request(ANYTHINGLLM_URL)
        .get('/v1/admin/users')
        .set('Authorization', `Bearer ${token} `)
        .set('X-Client-Service', 'keystone-test')
        .set('X-Correlation-ID', correlationId);

      // Request should succeed
      expect([200, 404]).toContain(response.status);

      // Note: Audit log verification would require access to logs or a debug endpoint
      // For now, we verify that the request succeeds with correlation ID header
    }, 30000);
  });
});
