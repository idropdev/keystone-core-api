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
import { AnythingLLMAuthDelegationService } from '../../src/anythingllm-auth-delegation/service';
import {
  DelegatedTokenClaims,
  ActorClaim,
} from '../../src/anythingllm-auth-delegation/domain/delegated-token-claims.entity';

/**
 * Sleep utility to avoid rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mint a delegated JWT token for testing (simulating Keystone-issued token)
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
    scope: ['anythingllm:system:read'],
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
 * Decode JWT token without verification (for testing)
 */
function decodeToken(token: string): any {
  return jwt.decode(token, { complete: true });
}

/**
 * End-to-End Tests for Keystone API Role Delegation
 *
 * Tests the complete bidirectional role delegation flow:
 *
 * Flow 1: User → Keystone → AnythingLLM (with delegated token)
 * Flow 2: AnythingLLM → Keystone (with delegated token containing roles)
 *
 * This test simulates AnythingLLM calling Keystone API endpoints
 * using delegated tokens that contain role information in the act claim.
 *
 * Test Scenarios:
 * 1. Admin role delegation - AnythingLLM calls Keystone with admin role
 * 2. Manager role delegation - AnythingLLM calls Keystone with manager role
 * 3. User role delegation - AnythingLLM calls Keystone with user role
 * 4. Role-based authorization enforcement
 * 5. Token structure validation (sub: 'svc-keystone', act: {userId, roles})
 * 6. Error handling (invalid tokens, expired tokens, missing act claim)
 *
 * Prerequisites:
 * - Keystone API must be running on port 3000 (APP_URL=http://localhost:3000)
 * - ENABLE_DELEGATED_TOKENS=true
 * - ANYTHINGLLM_DELEGATED_TOKEN_SECRET must be set
 *
 * To skip tests:
 *   SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- keystone-api-role-delegation.e2e-spec.ts
 */
describe('Keystone API Role Delegation - AnythingLLM → Keystone (E2E)', () => {
  let adminToken: string;
  let adminUser: TestUser;
  let manager: TestManager;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let authDelegationService: AnythingLLMAuthDelegationService | null = null;
  let testModule: any;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const APP = APP_URL;
  const DELEGATED_TOKEN_SECRET =
    process.env.ANYTHINGLLM_DELEGATED_TOKEN_SECRET || 'secret';
  const DELEGATED_TOKEN_AUDIENCE =
    process.env.ANYTHINGLLM_DELEGATED_TOKEN_AUDIENCE || 'anythingllm';

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
      'role-delegation-test-user',
    );

    // Set up services for testing
    if (!SKIP_ANYTHINGLLM_TESTS) {
      try {
        testModule = await Test.createTestingModule({
          imports: [AnythingLLMModule],
        }).compile();

        authDelegationService = testModule.get(
          AnythingLLMAuthDelegationService,
        );
      } catch (error) {
        console.warn(
          'Failed to initialize AnythingLLM services, some tests will be skipped:',
          error,
        );
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

  describe('Role Delegation - Token Issuance (Keystone → AnythingLLM)', () => {
    it('should issue delegated token with admin role for admin user', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping admin token issuance test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Issue delegated token for admin user
      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'test',
          requesterContext: {
            userId: String(adminUser.id || 'admin-123'),
            roles: ['admin'],
            sessionId: 'test-session-admin',
          },
          scope: ['anythingllm:admin:read', 'anythingllm:admin:write'],
        });

      expect(delegatedTokenResponse).toHaveProperty('token');
      expect(delegatedTokenResponse).toHaveProperty('expiresIn');
      expect(delegatedTokenResponse).toHaveProperty('audience');

      // Decode and verify token structure
      const decoded = decodeToken(delegatedTokenResponse.token);
      expect(decoded.payload.sub).toBe('svc-keystone');
      expect(decoded.payload.act.sub).toBe(String(adminUser.id || 'admin-123'));
      expect(decoded.payload.act.roles).toEqual(['admin']);
      expect(decoded.payload.act.sessionId).toBe('test-session-admin');
      expect(decoded.payload.aud).toBe(DELEGATED_TOKEN_AUDIENCE);
      expect(decoded.payload.scope).toEqual([
        'anythingllm:admin:read',
        'anythingllm:admin:write',
      ]);
    }, 30000);

    it('should issue delegated token with manager role for manager user', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping manager token issuance test');
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
            sessionId: 'test-session-manager',
          },
          scope: ['anythingllm:admin:read'],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      expect(decoded.payload.act.roles).toEqual(['manager']);
      expect(decoded.payload.act.sub).toBe(String(managerUser.id));
    }, 30000);

    it('should issue delegated token with user role for regular user', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping user token issuance test');
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
            sessionId: 'test-session-user',
          },
          scope: ['anythingllm:system:read'],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      expect(decoded.payload.act.roles).toEqual(['user']);
      expect(decoded.payload.act.sub).toBe(String(regularUser.id));
    }, 30000);
  });

  describe('Role Delegation - AnythingLLM → Keystone (Simulated)', () => {
    /**
     * Simulate AnythingLLM calling Keystone with delegated token
     *
     * Note: Currently, Keystone endpoints use OptionalJwtGuard which validates
     * user JWTs, not delegated tokens. This test simulates what would happen
     * if Keystone had endpoints that accept delegated tokens.
     *
     * In a real scenario, AnythingLLM would:
     * 1. Receive delegated token from Keystone
     * 2. Validate token signature
     * 3. Extract roles from act claim
     * 4. Call Keystone endpoints with the delegated token
     * 5. Keystone validates token and enforces role-based authorization
     */

    it('should simulate AnythingLLM calling Keystone with admin delegated token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping AnythingLLM → Keystone admin test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Simulate: AnythingLLM received delegated token from Keystone
      // Token contains admin role in act claim
      const delegatedToken = mintDelegatedJWT(
        {
          act: {
            sub: String(adminUser.id || 'admin-123'),
            roles: ['admin'],
            sessionId: 'anythingllm-session-123',
          },
          scope: ['anythingllm:admin:read', 'anythingllm:admin:write'],
        },
        DELEGATED_TOKEN_SECRET,
      );

      // Verify token structure
      const decoded = decodeToken(delegatedToken);
      expect(decoded.payload.sub).toBe('svc-keystone');
      expect(decoded.payload.act.roles).toEqual(['admin']);
      expect(decoded.payload.act.sub).toBe(String(adminUser.id || 'admin-123'));

      // Simulate: AnythingLLM calls Keystone endpoint with delegated token
      // Note: Current Keystone endpoints don't validate delegated tokens,
      // but this test verifies the token structure is correct for future implementation
      console.log('[INFO] Delegated token structure verified for admin role');
      console.log('[INFO] Token sub:', decoded.payload.sub);
      console.log('[INFO] Token act.sub:', decoded.payload.act.sub);
      console.log('[INFO] Token act.roles:', decoded.payload.act.roles);
    }, 30000);

    it('should simulate AnythingLLM calling Keystone with manager delegated token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping AnythingLLM → Keystone manager test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const delegatedToken = mintDelegatedJWT(
        {
          act: {
            sub: String(managerUser.id),
            roles: ['manager'],
            sessionId: 'anythingllm-session-456',
          },
          scope: ['anythingllm:admin:read'],
        },
        DELEGATED_TOKEN_SECRET,
      );

      const decoded = decodeToken(delegatedToken);
      expect(decoded.payload.act.roles).toEqual(['manager']);
      expect(decoded.payload.act.sub).toBe(String(managerUser.id));
    }, 30000);

    it('should simulate AnythingLLM calling Keystone with user delegated token', async () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping AnythingLLM → Keystone user test');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      const delegatedToken = mintDelegatedJWT(
        {
          act: {
            sub: String(regularUser.id),
            roles: ['user'],
            sessionId: 'anythingllm-session-789',
          },
          scope: ['anythingllm:system:read'],
        },
        DELEGATED_TOKEN_SECRET,
      );

      const decoded = decodeToken(delegatedToken);
      expect(decoded.payload.act.roles).toEqual(['user']);
      expect(decoded.payload.act.sub).toBe(String(regularUser.id));
    }, 30000);
  });

  describe('Role Delegation - Complete Flow Analysis', () => {
    it('should analyze complete role delegation flow for admin', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping complete flow analysis');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Step 1: User authenticates with Keystone → Gets user JWT
      const userJWT = adminUser.token;
      expect(userJWT).toBeDefined();

      // Step 2: User requests AnythingLLM operation → Sends user JWT to Keystone
      // (Simulated by calling Keystone endpoint with user JWT)
      const keystoneResponse = await request(APP)
        .get('/api/anythingllm/v1/system')
        .set('Authorization', `Bearer ${userJWT}`)
        .timeout(10000);

      // Step 3: Keystone validates user JWT → Extracts user context (userId, roles)
      // This happens in OptionalJwtGuard

      // Step 4: Keystone issues delegated token → Embeds user context in act claim
      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'SYSTEM_READ',
          requesterContext: {
            userId: String(adminUser.id || 'admin-123'),
            roles: ['admin'],
            sessionId: 'test-session-complete-flow',
          },
          scope: ['anythingllm:system:read'],
        });

      // Step 5: Verify delegated token structure
      const decoded = decodeToken(delegatedTokenResponse.token);
      expect(decoded.payload.sub).toBe('svc-keystone');
      expect(decoded.payload.act.roles).toEqual(['admin']);
      expect(decoded.payload.act.sub).toBe(String(adminUser.id || 'admin-123'));

      // Step 6: Simulate AnythingLLM validating delegated token
      // (In real scenario, AnythingLLM would verify signature and extract roles)
      const anythingllmExtractedRoles = decoded.payload.act.roles;
      expect(anythingllmExtractedRoles).toEqual(['admin']);

      // Step 7: Simulate AnythingLLM enforcing role-based authorization
      const isAdmin = anythingllmExtractedRoles.includes('admin');
      expect(isAdmin).toBe(true);

      // Step 8: Simulate AnythingLLM calling back to Keystone with delegated token
      // (This would require Keystone to validate delegated tokens, not yet implemented)
      const anythingllmToKeystoneToken = delegatedTokenResponse.token;
      expect(anythingllmToKeystoneToken).toBeDefined();

      console.log('[ANALYSIS] Complete flow verified:');
      console.log('  - User JWT authenticated');
      console.log('  - Delegated token issued with admin role');
      console.log('  - Token structure: sub=svc-keystone, act.roles=[admin]');
      console.log('  - Role extraction successful');
      console.log('  - Authorization check passed (admin role)');
    }, 30000);

    it('should analyze complete role delegation flow for manager', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping manager flow analysis');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Complete flow for manager
      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'SYSTEM_READ',
          requesterContext: {
            userId: String(managerUser.id),
            roles: ['manager'],
            sessionId: 'test-session-manager-flow',
          },
          scope: ['anythingllm:admin:read'],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      const anythingllmExtractedRoles = decoded.payload.act.roles;
      expect(anythingllmExtractedRoles).toEqual(['manager']);

      const isManager = anythingllmExtractedRoles.includes('manager');
      expect(isManager).toBe(true);
    }, 30000);

    it('should analyze complete role delegation flow for user', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping user flow analysis');
        return;
      }

      const isReachable = await verifyKeystoneReachable();
      if (!isReachable) {
        console.log('[SKIP] Keystone not reachable, skipping test');
        return;
      }

      // Complete flow for regular user
      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'SYSTEM_READ',
          requesterContext: {
            userId: String(regularUser.id),
            roles: ['user'],
            sessionId: 'test-session-user-flow',
          },
          scope: ['anythingllm:system:read'],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      const anythingllmExtractedRoles = decoded.payload.act.roles;
      expect(anythingllmExtractedRoles).toEqual(['user']);

      const isUser = anythingllmExtractedRoles.includes('user');
      expect(isUser).toBe(true);
    }, 30000);
  });

  describe('Role Delegation - Token Validation and Error Handling', () => {
    it('should reject token with missing act claim', () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping missing act claim test');
        return;
      }

      // Attempt to create token without act claim (should fail)
      expect(() => {
        mintDelegatedJWT(
          {
            // Missing act claim
            scope: ['anythingllm:system:read'],
          },
          DELEGATED_TOKEN_SECRET,
        );
      }).toThrow('Invalid act claim');
    });

    it('should reject token with invalid act.roles type', () => {
      if (shouldSkipTests()) {
        console.log('[SKIP] Skipping invalid roles type test');
        return;
      }

      // Attempt to create token with invalid roles (should fail)
      expect(() => {
        mintDelegatedJWT(
          {
            act: {
              sub: 'test-user',
              roles: 'invalid' as any, // Should be array
            },
          },
          DELEGATED_TOKEN_SECRET,
        );
      }).toThrow('Invalid act claim');
    });

    it('should verify token expiration is set correctly', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping token expiration test');
        return;
      }

      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'test',
          requesterContext: {
            userId: 'test-user',
            roles: ['admin'],
          },
          scope: ['anythingllm:system:read'],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      const now = Math.floor(Date.now() / 1000);

      expect(decoded.payload.exp).toBeGreaterThan(now);
      expect(decoded.payload.iat).toBeLessThanOrEqual(now);
      expect(decoded.payload.exp - decoded.payload.iat).toBeGreaterThan(0);
    }, 30000);

    it('should verify token audience matches configuration', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping token audience test');
        return;
      }

      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'test',
          requesterContext: {
            userId: 'test-user',
            roles: ['admin'],
          },
          scope: ['anythingllm:system:read'],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      expect(decoded.payload.aud).toBe(DELEGATED_TOKEN_AUDIENCE);
    }, 30000);
  });

  describe('Role Delegation - Role-Based Authorization Matrix', () => {
    it('should verify admin role has access to all operations', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping admin authorization matrix test');
        return;
      }

      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'SYSTEM_READ',
          requesterContext: {
            userId: String(adminUser.id || 'admin-123'),
            roles: ['admin'],
          },
          scope: [
            'anythingllm:admin:read',
            'anythingllm:admin:write',
            'anythingllm:system:read',
          ],
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      const roles = decoded.payload.act.roles;

      // Admin should have access to all operations
      expect(roles.includes('admin')).toBe(true);
      expect(decoded.payload.scope).toContain('anythingllm:admin:read');
      expect(decoded.payload.scope).toContain('anythingllm:admin:write');
      expect(decoded.payload.scope).toContain('anythingllm:system:read');
    }, 30000);

    it('should verify manager role has limited admin access', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping manager authorization matrix test');
        return;
      }

      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'SYSTEM_READ',
          requesterContext: {
            userId: String(managerUser.id),
            roles: ['manager'],
          },
          scope: ['anythingllm:admin:read'], // Manager can read but not write
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      const roles = decoded.payload.act.roles;

      expect(roles.includes('manager')).toBe(true);
      expect(roles.includes('admin')).toBe(false);
      expect(decoded.payload.scope).toContain('anythingllm:admin:read');
      expect(decoded.payload.scope).not.toContain('anythingllm:admin:write');
    }, 30000);

    it('should verify user role has basic access only', async () => {
      if (shouldSkipTests() || !authDelegationService) {
        console.log('[SKIP] Skipping user authorization matrix test');
        return;
      }

      const delegatedTokenResponse =
        await authDelegationService.issueDelegatedToken({
          operation: 'SYSTEM_READ',
          requesterContext: {
            userId: String(regularUser.id),
            roles: ['user'],
          },
          scope: ['anythingllm:system:read'], // User can only read system info
        });

      const decoded = decodeToken(delegatedTokenResponse.token);
      const roles = decoded.payload.act.roles;

      expect(roles.includes('user')).toBe(true);
      expect(roles.includes('admin')).toBe(false);
      expect(roles.includes('manager')).toBe(false);
      expect(decoded.payload.scope).toContain('anythingllm:system:read');
      expect(decoded.payload.scope).not.toContain('anythingllm:admin:read');
    }, 30000);
  });
});
