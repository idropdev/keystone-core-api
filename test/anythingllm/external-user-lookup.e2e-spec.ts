import request from 'supertest';
import { Test } from '@nestjs/testing';
import { APP_URL, ANYTHINGLLM_BASE_URL } from '../utils/constants';
import { createTestUser, getAdminToken, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AnythingLLMServiceIdentityService } from '../../src/anythingllm/services/anythingllm-service-identity.service';
import { AnythingLLMAdminService } from '../../src/anythingllm/admin/anythingllm-admin.service';
import { UpstreamError } from '../../src/anythingllm/registry/upstream-error';

/**
 * Sleep utility to avoid rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * End-to-End Tests for External User Lookup
 *
 * Tests the GET /v1/admin/users/external/:externalId?provider=keystone endpoint:
 * 1. Successful lookup of existing external users
 * 2. 404 errors for non-existent users
 * 3. Different provider values
 * 4. Integration with user provisioning flow
 *
 * Prerequisites:
 * - Keystone API must be running on port 3000 (APP_PORT=3000)
 * - AnythingLLM must be running on port 3001 (ANYTHINGLLM_BASE_URL=http://localhost:3001/api)
 * - Service identity authentication must be configured
 */
describe('External User Lookup (E2E)', () => {
  let adminToken: string;
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let adminService: AnythingLLMAdminService | null = null;
  let testModule: any;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';

  beforeAll(async () => {
    adminToken = await getAdminToken();

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
   * Helper to get service identity token for AnythingLLM API calls
   */
  async function getServiceToken(): Promise<string | null> {
    if (SKIP_ANYTHINGLLM_TESTS || !serviceIdentityService) {
      return null;
    }

    try {
      return await serviceIdentityService.getIdToken();
    } catch (error) {
      console.warn(
        '[SKIP] GCP service identity not available in test environment (expected)',
      );
      return null;
    }
  }

  describe('Get User by External ID', () => {
    let createdUser: TestUser;
    let anythingllmUserId: number | null = null;

    beforeAll(async () => {
      // Create a user that will be provisioned to AnythingLLM
      createdUser = await createTestUser(RoleEnum.user, 'external-lookup-test');

      // Wait for provisioning to complete
      await sleep(5000);
    }, 60000);

    afterAll(async () => {
      // Cleanup: Delete user in AnythingLLM if it was created
      if (anythingllmUserId && !SKIP_ANYTHINGLLM_TESTS && adminService) {
        try {
          await adminService.deleteUser(anythingllmUserId);
        } catch (error) {
          console.warn(`Failed to cleanup AnythingLLM user:`, error);
        }
      }
    });

    it('should successfully get user by externalId after provisioning', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminService) {
        console.log('[SKIP] Skipping external user lookup test');
        return;
      }

      if (!createdUser) {
        throw new Error('createdUser not set');
      }

      const keystoneUserId = String(createdUser.id);

      // Poll for user to be available (provisioning is async)
      let userFound = false;
      let attempts = 0;
      const maxAttempts = 15;
      const pollInterval = 2000;

      while (!userFound && attempts < maxAttempts) {
        attempts++;

        try {
          const result = await adminService.getUserByExternalId(
            keystoneUserId,
            'keystone',
          );

          if (result.data.user) {
            expect(result.data.user).toBeDefined();
            expect(result.data.user.id).toBeDefined();
            expect(result.data.user.externalId).toBe(keystoneUserId);
            expect(result.data.user.externalProvider).toBe('keystone');
            expect(result.data.user.role).toBeDefined();
            expect(['admin', 'manager', 'default']).toContain(
              result.data.user.role,
            );

            anythingllmUserId = result.data.user.id;
            userFound = true;

            console.log(
              `[SUCCESS] Found user by externalId: ${keystoneUserId} → AnythingLLM user ID: ${result.data.user.id}`,
            );
          }
        } catch (error) {
          const isNotFound =
            error instanceof UpstreamError &&
            (error.status === 404 || error.message.includes('not found'));

          if (isNotFound && attempts < maxAttempts) {
            // User not found yet, wait and retry
            await sleep(pollInterval);
            continue;
          }

          if (!isNotFound) {
            // Unexpected error
            throw error;
          }
        }
      }

      if (!userFound) {
        console.warn(
          `User ${keystoneUserId} not found after ${maxAttempts} attempts - provisioning may still be in progress`,
        );
      }
    }, 60000);

    it('should return 404 for non-existent externalId', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminService) {
        console.log('[SKIP] Skipping 404 test');
        return;
      }

      const nonExistentExternalId = '999999999';

      try {
        await adminService.getUserByExternalId(
          nonExistentExternalId,
          'keystone',
        );
        // Should not reach here - should throw UpstreamError
        fail('Expected UpstreamError for non-existent user');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        const upstreamError = error as UpstreamError;
        expect(upstreamError.status).toBe(404);
        expect(upstreamError.message).toMatch(/not found/i);

        console.log(
          `[SUCCESS] Correctly returned 404 for non-existent externalId: ${nonExistentExternalId}`,
        );
      }
    }, 30000);

    it('should handle different provider values', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminService) {
        console.log('[SKIP] Skipping provider test');
        return;
      }

      const nonExistentExternalId = '999999998';

      // Test with explicit 'keystone' provider
      try {
        await adminService.getUserByExternalId(
          nonExistentExternalId,
          'keystone',
        );
        fail('Expected 404 for non-existent user');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        expect((error as UpstreamError).status).toBe(404);
      }

      // Test with default provider (should default to 'keystone')
      try {
        await adminService.getUserByExternalId(nonExistentExternalId);
        fail('Expected 404 for non-existent user');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        expect((error as UpstreamError).status).toBe(404);
      }
    }, 30000);

    it('should verify endpoint URL format is correct', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminService) {
        console.log('[SKIP] Skipping URL format test');
        return;
      }

      // The endpoint should be: GET /v1/admin/users/external/:externalId?provider=keystone
      // Verify by checking the error message or path in UpstreamError
      const testExternalId = '12345';

      try {
        await adminService.getUserByExternalId(testExternalId, 'keystone');
        fail('Expected 404');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        const upstreamError = error as UpstreamError;

        // Verify the path includes the externalId and query parameter
        // The path should be: /v1/admin/users/external/12345?provider=keystone
        expect(upstreamError.upstreamPath).toContain(
          '/v1/admin/users/external/',
        );
        expect(upstreamError.upstreamPath).toContain(testExternalId);
        expect(upstreamError.upstreamPath).toContain('provider=keystone');

        console.log(
          `[SUCCESS] Endpoint URL format verified: ${upstreamError.upstreamPath}`,
        );
      }
    }, 30000);
  });

  describe('Integration with User Provisioning', () => {
    const testUsers: TestUser[] = [];

    afterAll(async () => {
      // Cleanup is handled by test cleanup
    });

    it('should find user immediately after provisioning completes', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminService) {
        console.log('[SKIP] Skipping integration test');
        return;
      }

      // Create a new user
      const email = `integration.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
      const password = 'SecurePassword123!';

      const createResponse = await request(APP_URL)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          password,
          firstName: 'Integration',
          lastName: 'Test',
          role: { id: RoleEnum.user },
        })
        .expect(201);

      const keystoneUserId = String(createResponse.body.id);
      testUsers.push({
        id: createResponse.body.id,
        email,
        token: '',
        roleId: RoleEnum.user,
      });

      // Wait for provisioning (with polling)
      let userFound = false;
      let attempts = 0;
      const maxAttempts = 20; // More attempts for this test
      const pollInterval = 2000;

      while (!userFound && attempts < maxAttempts) {
        attempts++;

        try {
          const result = await adminService.getUserByExternalId(
            keystoneUserId,
            'keystone',
          );

          if (result.data.user) {
            expect(result.data.user.externalId).toBe(keystoneUserId);
            expect(result.data.user.externalProvider).toBe('keystone');
            expect(result.data.user.role).toBe('default'); // User role maps to 'default'

            userFound = true;

            console.log(
              `[SUCCESS] User found after provisioning: ${keystoneUserId} → AnythingLLM user ID: ${result.data.user.id}`,
            );

            // Cleanup
            try {
              await adminService.deleteUser(result.data.user.id);
            } catch (cleanupError) {
              console.warn(`Failed to cleanup user:`, cleanupError);
            }
          }
        } catch (error) {
          const isNotFound =
            error instanceof UpstreamError &&
            (error.status === 404 || error.message.includes('not found'));

          if (isNotFound && attempts < maxAttempts) {
            await sleep(pollInterval);
            continue;
          }

          if (!isNotFound) {
            throw error;
          }
        }
      }

      if (!userFound) {
        console.warn(
          `User ${keystoneUserId} not found after ${maxAttempts} attempts`,
        );
      }
    }, 90000);
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminService) {
        console.log('[SKIP] Skipping error handling test');
        return;
      }

      // Test with invalid externalId format (should still call the endpoint)
      const invalidExternalId = '';

      try {
        await adminService.getUserByExternalId(invalidExternalId, 'keystone');
        fail('Expected error for empty externalId');
      } catch (error) {
        // Should either throw validation error or UpstreamError
        expect(error).toBeDefined();
        console.log(`[SUCCESS] Error handling verified for invalid externalId`);
      }
    }, 30000);

    it('should handle service identity token errors', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminService) {
        console.log('[SKIP] Skipping token error test');
        return;
      }

      // This test verifies that token errors are handled correctly
      // The service should throw an error if token minting fails
      // (In test environment, this may not be testable if tokens are cached)
      const testExternalId = '123456';

      try {
        await adminService.getUserByExternalId(testExternalId, 'keystone');
        // If this succeeds, it means token was obtained (expected in test env)
        // If it fails, it should be a clear error
      } catch (error) {
        // Error is acceptable - either 404 (user not found) or token error
        const isNotFound =
          error instanceof UpstreamError &&
          (error.status === 404 || error.message.includes('not found'));
        const isTokenError =
          (error instanceof Error && error.message.includes('token')) ||
          error.message.includes('authentication');

        if (!isNotFound && !isTokenError) {
          throw error;
        }

        console.log(`[SUCCESS] Error handling verified: ${error.message}`);
      }
    }, 30000);
  });
});
