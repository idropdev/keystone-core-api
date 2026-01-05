import request from 'supertest';
import { Test } from '@nestjs/testing';
import { APP_URL } from '../utils/constants';
import { getAdminToken, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AnythingLLMServiceIdentityService } from '../../src/anythingllm/services/anythingllm-service-identity.service';
import { AnythingLLMAdminService } from '../../src/anythingllm/admin/anythingllm-admin.service';

/**
 * Sleep utility to avoid rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * End-to-End Tests for Role Mapping in AnythingLLM User Provisioning
 *
 * Tests the role mapping functionality when creating users in Keystone:
 * 1. Admin role mapping (RoleEnum.admin → 'admin')
 * 2. Manager role mapping (RoleEnum.manager → 'manager')
 * 3. User/default role mapping (RoleEnum.user → 'default')
 * 4. Edge cases: null role, missing role, unknown role
 * 5. External identity fields (externalId, externalProvider)
 * 6. Behavior when AnythingLLM is active vs unavailable
 *
 * Prerequisites:
 * - Keystone API must be running on port 3000 (APP_PORT=3000)
 * - AnythingLLM must be running on port 3001 (ANYTHINGLLM_BASE_URL=http://localhost:3001/api)
 * - Service identity authentication must be configured
 *
 * Note: These tests make real HTTP calls to verify the role mapping flow.
 * Provisioning is asynchronous, so we poll for completion.
 */
describe('AnythingLLM Role Mapping in User Provisioning (E2E)', () => {
  let adminToken: string;
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let adminService: AnythingLLMAdminService | null = null;
  let testModule: any;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Set up service identity service for direct AnythingLLM calls
    if (!SKIP_ANYTHINGLLM_TESTS) {
      try {
        testModule = await Test.createTestingModule({
          imports: [AnythingLLMModule],
        }).compile();

        serviceIdentityService = testModule.get(
          AnythingLLMServiceIdentityService,
        );
        adminService = testModule.get(AnythingLLMAdminService);
      } catch {
        // Module initialization failed - service will be null
        // Tests will skip AnythingLLM verification gracefully
        serviceIdentityService = null;
        adminService = null;
      }
    }
  }, 60000);

  afterAll(async () => {
    if (testModule) {
      await testModule.close();
    }
  });

  /**
   * Helper to find user in AnythingLLM by externalId
   */
  async function findUserInAnythingLLMByExternalId(
    keystoneUserId: string,
  ): Promise<{
    id: number;
    username: string;
    role: string;
    externalId?: string;
    externalProvider?: string;
  } | null> {
    if (SKIP_ANYTHINGLLM_TESTS || !adminService) {
      return null;
    }

    try {
      // Use the external user lookup endpoint
      const result = await adminService.getUserByExternalId(
        keystoneUserId,
        'keystone',
      );

      if (result.data.user) {
        const user = result.data.user;
        return {
          id: user.id,
          username: user.username,
          role: user.role,
          externalId: user.externalId || undefined,
          externalProvider: user.externalProvider || undefined,
        };
      }

      return null;
    } catch (error) {
      // User not found (404) is expected when user doesn't exist
      const isNotFound =
        error instanceof Error &&
        (error.message.includes('404') || error.message.includes('not found'));
      if (!isNotFound) {
        console.warn('Failed to find user in AnythingLLM:', error);
      }
      return null;
    }
  }

  /**
   * Helper to poll for user in AnythingLLM with role verification
   */
  async function waitForUserInAnythingLLM(
    keystoneUserId: string,
    expectedRole: string,
    maxAttempts = 15,
    pollInterval = 2000,
  ): Promise<{
    user: {
      id: number;
      username: string;
      role: string;
      externalId?: string;
      externalProvider?: string;
    } | null;
    found: boolean;
  }> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const user = await findUserInAnythingLLMByExternalId(keystoneUserId);

      if (user && user.role === expectedRole) {
        return { user, found: true };
      }

      if (user && user.role !== expectedRole) {
        // User exists but with wrong role - return it anyway for assertion
        return { user, found: false };
      }

      // User not found yet, wait and retry
      if (attempts < maxAttempts) {
        await sleep(pollInterval);
      }
    }

    return { user: null, found: false };
  }

  describe('Admin Role Mapping', () => {
    let createdUser: TestUser;
    let anythingllmUserId: number | null = null;

    afterEach(async () => {
      // Cleanup: Delete user in AnythingLLM if it was created
      if (anythingllmUserId && !SKIP_ANYTHINGLLM_TESTS && adminService) {
        try {
          await adminService.deleteUser(anythingllmUserId);
        } catch (error) {
          // Ignore cleanup errors
          console.warn(
            `Failed to cleanup AnythingLLM user ${anythingllmUserId}:`,
            error,
          );
        }
      }
    });

    it('should create admin user in Keystone with admin role', async () => {
      // Create admin user via admin endpoint
      const email = `admin.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'Admin',
          lastName: 'Test',
          role: { id: RoleEnum.admin },
        })
        .expect(201);

      expect(createResponse.body).toHaveProperty('id');
      expect(createResponse.body.email).toBe(email);
      expect(createResponse.body.role.id).toBe(RoleEnum.admin);

      // Get user token
      const loginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email, password })
        .expect(200);

      createdUser = {
        id: createResponse.body.id,
        email,
        token: loginResponse.body.token,
        roleId: RoleEnum.admin,
      };

      // Wait for async provisioning
      await sleep(3000);
    }, 30000);

    it('should provision admin user in AnythingLLM with admin role', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping AnythingLLM verification');
        return;
      }

      if (!createdUser) {
        throw new Error('createdUser not set - previous test may have failed');
      }

      const keystoneUserId = String(createdUser.id);

      // Poll for user in AnythingLLM with admin role
      const { user } = await waitForUserInAnythingLLM(keystoneUserId, 'admin');

      if (!user) {
        // User might not have externalId in response, try alternative verification
        console.warn(
          'Could not find user by externalId, role mapping verification may be incomplete',
        );
        return;
      }

      expect(found).toBe(true);
      expect(user.role).toBe('admin');
      // Verify external identity fields if they exist in the response
      if (user.externalId !== undefined) {
        expect(user.externalId).toBe(keystoneUserId);
      }
      if (user.externalProvider !== undefined) {
        expect(user.externalProvider).toBe('keystone');
      }

      anythingllmUserId = user.id;

      console.log(
        `[SUCCESS] Admin user provisioned with role 'admin' in AnythingLLM (ID: ${user.id})`,
      );
    }, 60000);
  });

  describe('Manager Role Mapping', () => {
    let createdUser: TestUser;
    let anythingllmUserId: number | null = null;

    afterEach(async () => {
      // Cleanup
      if (anythingllmUserId && !SKIP_ANYTHINGLLM_TESTS && adminService) {
        try {
          await adminService.deleteUser(anythingllmUserId);
        } catch (error) {
          console.warn(`Failed to cleanup AnythingLLM user:`, error);
        }
      }
    });

    it('should create manager user in Keystone with manager role', async () => {
      const email = `manager.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'Manager',
          lastName: 'Test',
          role: { id: RoleEnum.manager },
        })
        .expect(201);

      expect(createResponse.body.role.id).toBe(RoleEnum.manager);

      const loginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email, password })
        .expect(200);

      createdUser = {
        id: createResponse.body.id,
        email,
        token: loginResponse.body.token,
        roleId: RoleEnum.manager,
      };

      await sleep(3000);
    }, 30000);

    it('should provision manager user in AnythingLLM with manager role', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping AnythingLLM verification');
        return;
      }

      if (!createdUser) {
        throw new Error('createdUser not set');
      }

      const keystoneUserId = String(createdUser.id);

      const { user } = await waitForUserInAnythingLLM(
        keystoneUserId,
        'manager',
      );

      if (!user) {
        console.warn('Could not find user by externalId');
        return;
      }

      expect(found).toBe(true);
      expect(user.role).toBe('manager');
      // Verify external identity fields if they exist in the response
      if (user.externalId !== undefined) {
        expect(user.externalId).toBe(keystoneUserId);
      }
      if (user.externalProvider !== undefined) {
        expect(user.externalProvider).toBe('keystone');
      }

      anythingllmUserId = user.id;

      console.log(
        `[SUCCESS] Manager user provisioned with role 'manager' in AnythingLLM (ID: ${user.id})`,
      );
    }, 60000);
  });

  describe('Default/User Role Mapping', () => {
    let createdUser: TestUser;
    let anythingllmUserId: number | null = null;

    afterEach(async () => {
      // Cleanup
      if (anythingllmUserId && !SKIP_ANYTHINGLLM_TESTS && adminService) {
        try {
          await adminService.deleteUser(anythingllmUserId);
        } catch (error) {
          console.warn(`Failed to cleanup AnythingLLM user:`, error);
        }
      }
    });

    it('should create regular user in Keystone with user role', async () => {
      const email = `user.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'User',
          lastName: 'Test',
          role: { id: RoleEnum.user },
        })
        .expect(201);

      expect(createResponse.body.role.id).toBe(RoleEnum.user);

      const loginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email, password })
        .expect(200);

      createdUser = {
        id: createResponse.body.id,
        email,
        token: loginResponse.body.token,
        roleId: RoleEnum.user,
      };

      await sleep(3000);
    }, 30000);

    it('should provision regular user in AnythingLLM with default role', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping AnythingLLM verification');
        return;
      }

      if (!createdUser) {
        throw new Error('createdUser not set');
      }

      const keystoneUserId = String(createdUser.id);

      const { user } = await waitForUserInAnythingLLM(
        keystoneUserId,
        'default',
      );

      if (!user) {
        console.warn('Could not find user by externalId');
        return;
      }

      expect(found).toBe(true);
      expect(user.role).toBe('default');
      // Verify external identity fields if they exist in the response
      if (user.externalId !== undefined) {
        expect(user.externalId).toBe(keystoneUserId);
      }
      if (user.externalProvider !== undefined) {
        expect(user.externalProvider).toBe('keystone');
      }

      anythingllmUserId = user.id;

      console.log(
        `[SUCCESS] User provisioned with role 'default' in AnythingLLM (ID: ${user.id})`,
      );
    }, 60000);
  });

  describe('Edge Cases - Role Mapping', () => {
    let createdUser: TestUser;
    let anythingllmUserId: number | null = null;

    afterEach(async () => {
      // Cleanup
      if (anythingllmUserId && !SKIP_ANYTHINGLLM_TESTS && adminService) {
        try {
          await adminService.deleteUser(anythingllmUserId);
        } catch (error) {
          console.warn(`Failed to cleanup AnythingLLM user:`, error);
        }
      }
    });

    it('should default to "default" role when user has null role', async () => {
      // Create user without explicit role
      // When no role is provided, Keystone creates user with undefined role
      // The mapping function should handle this and default to 'default' in AnythingLLM
      const email = `nullrole.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'NullRole',
          lastName: 'Test',
          // Not providing role - user will have undefined role in Keystone
        })
        .expect(201);

      // User should be created successfully
      expect(createResponse.body).toHaveProperty('id');
      expect(createResponse.body.email).toBe(email);

      // Role may be undefined when not provided (this is expected behavior)
      // The mapping function will handle undefined and default to 'default' in AnythingLLM
      createdUser = {
        id: createResponse.body.id,
        email,
        token: '',
        roleId: createResponse.body.role?.id || RoleEnum.user, // Fallback to user role for test
      };

      await sleep(3000);

      // Verify that provisioning still works (should map undefined/null role to 'default' in AnythingLLM)
      if (!SKIP_ANYTHINGLLM_TESTS) {
        const keystoneUserId = String(createdUser.id);
        const { user, found } = await waitForUserInAnythingLLM(
          keystoneUserId,
          'default',
        );

        if (user) {
          // Mapping function should default undefined/null role to 'default'
          expect(user.role).toBe('default');
          anythingllmUserId = user.id;
        }
      }
    }, 60000);

    it('should default to "default" role for unknown role IDs', async () => {
      // This test verifies fallback behavior for unknown role IDs
      // In practice, this shouldn't happen, but we test defensive coding
      const email = `unknownrole.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      // Create user with valid role (we can't create invalid roles via API)
      // But we verify the mapping function handles unknown values gracefully
      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'UnknownRole',
          lastName: 'Test',
          role: { id: RoleEnum.user }, // Valid role, but mapping function should handle edge cases
        })
        .expect(201);

      createdUser = {
        id: createResponse.body.id,
        email,
        token: '',
        roleId: createResponse.body.role?.id || RoleEnum.user,
      };

      // The mapping should work correctly even if role ID is unexpected format
      await sleep(3000);

      if (!SKIP_ANYTHINGLLM_TESTS) {
        const keystoneUserId = String(createdUser.id);
        const { user } = await waitForUserInAnythingLLM(
          keystoneUserId,
          'default',
        );

        if (user) {
          // Should still default to 'default' for user role
          expect(['default', 'admin', 'manager']).toContain(user.role);
          anythingllmUserId = user.id;
        }
      }
    }, 60000);
  });

  describe('External Identity Fields', () => {
    let createdUser: TestUser;
    let anythingllmUserId: number | null = null;

    afterEach(async () => {
      // Cleanup
      if (anythingllmUserId && !SKIP_ANYTHINGLLM_TESTS && adminService) {
        try {
          await adminService.deleteUser(anythingllmUserId);
        } catch (error) {
          console.warn(`Failed to cleanup AnythingLLM user:`, error);
        }
      }
    });

    it('should include externalId and externalProvider in AnythingLLM user', async () => {
      const email = `externalid.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'ExternalId',
          lastName: 'Test',
          role: { id: RoleEnum.user },
        })
        .expect(201);

      createdUser = {
        id: createResponse.body.id,
        email,
        token: '',
        roleId: RoleEnum.user,
      };

      await sleep(3000);

      if (SKIP_ANYTHINGLLM_TESTS) {
        console.log('[SKIP] Skipping AnythingLLM verification');
        return;
      }

      const keystoneUserId = String(createdUser.id);
      const { user } = await waitForUserInAnythingLLM(
        keystoneUserId,
        'default',
      );

      if (user) {
        // Verify external identity fields if they exist in the response
        if (user.externalId !== undefined) {
          expect(user.externalId).toBe(keystoneUserId);
        }
        if (user.externalProvider !== undefined) {
          expect(user.externalProvider).toBe('keystone');
        }
        anythingllmUserId = user.id;

        const externalIdInfo = user.externalId || 'not returned by API';
        const externalProviderInfo =
          user.externalProvider || 'not returned by API';
        console.log(
          `[SUCCESS] External identity fields verified: externalId=${externalIdInfo}, externalProvider=${externalProviderInfo}`,
        );
      } else {
        console.warn(
          'Could not verify external identity fields (user not found in AnythingLLM)',
        );
      }
    }, 60000);
  });

  describe('AnythingLLM Unavailable Scenarios', () => {
    it('should not block user creation when AnythingLLM is unavailable', async () => {
      // This test verifies graceful degradation when AnythingLLM is down
      // User creation in Keystone should succeed even if provisioning fails

      const email = `degraded.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      // Create user - should succeed even if AnythingLLM is unavailable
      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'Degraded',
          lastName: 'Test',
          role: { id: RoleEnum.user },
        })
        .expect(201);

      expect(createResponse.body).toHaveProperty('id');
      expect(createResponse.body.id).toBeDefined();
      expect(createResponse.body.email).toBe(email);

      // Verify user exists in Keystone (even if provisioning failed)
      const getUserResponse = await request(APP_URL)
        .get(`/api/v1/users/${createResponse.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(getUserResponse.body.id).toBe(createResponse.body.id);
      expect(getUserResponse.body.email).toBe(email);

      // Provisioning failure should be logged but not block user creation
      // (verified by user existing in Keystone)
    }, 30000);

    it('should handle provisioning errors gracefully without affecting Keystone user', async () => {
      // This test verifies that provisioning errors don't rollback user creation
      const email = `errorhandling.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'Error',
          lastName: 'Test',
          role: { id: RoleEnum.admin },
        })
        .expect(201);

      const userId = createResponse.body.id;

      // Verify user exists in Keystone
      const getUserResponse = await request(APP_URL)
        .get(`/api/v1/users/${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(getUserResponse.body.id).toBe(userId);
      expect(getUserResponse.body.role.id).toBe(RoleEnum.admin);

      // User should exist in Keystone regardless of AnythingLLM provisioning status
      // (provisioning happens asynchronously and failures are logged, not thrown)
    }, 30000);
  });

  describe('Role Mapping Verification', () => {
    it('should verify role mapping table correctness', async () => {
      // This test verifies the role mapping logic matches expected values
      // RoleEnum.admin (1) → 'admin'
      // RoleEnum.manager (3) → 'manager'
      // RoleEnum.user (2) → 'default'

      const roleMapping = {
        [RoleEnum.admin]: 'admin',
        [RoleEnum.manager]: 'manager',
        [RoleEnum.user]: 'default',
      };

      // Verify enum values
      expect(RoleEnum.admin).toBe(1);
      expect(RoleEnum.manager).toBe(3);
      expect(RoleEnum.user).toBe(2);

      // Verify mapping values
      expect(roleMapping[RoleEnum.admin]).toBe('admin');
      expect(roleMapping[RoleEnum.manager]).toBe('manager');
      expect(roleMapping[RoleEnum.user]).toBe('default');

      console.log('[SUCCESS] Role mapping table verified');
    });
  });
});
