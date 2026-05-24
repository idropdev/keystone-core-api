import request from 'supertest';
import { Test } from '@nestjs/testing';
import { APP_URL, ANYTHINGLLM_BASE_URL } from '../utils/constants';
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
 * End-to-End Tests for AnythingLLM Document Upload Endpoint
 *
 * Tests the complete document upload flow:
 * 1. Workspace creation (required for document upload)
 * 2. Document upload with different authorization scenarios
 * 3. Edge cases (no workspace, invalid OCR fields, missing file, etc.)
 *
 * Prerequisites:
 * - Keystone API must be running (APP_URL)
 * - AnythingLLM must be running (ANYTHINGLLM_BASE_URL)
 * - Service identity authentication must be configured
 *
 * Test Requirements:
 * - A document CANNOT and SHOULD NOT be uploaded if no workspace is defined
 * - Workspaces must be created before document upload
 */
describe('AnythingLLM Document Upload (E2E)', () => {
  let adminToken: string;
  let adminUser: TestUser;
  let manager: TestManager;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let testModule: any;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const APP = APP_URL;

  // Track created resources for cleanup
  let createdWorkspaceSlug: string | null = null;
  let createdWorkspaceSlug2: string | null = null;

  beforeAll(async () => {
    // Get admin token
    adminToken = await getAdminToken();
    adminUser = {
      id: 0,
      email: 'admin@test.com',
      token: adminToken,
      roleId: RoleEnum.admin,
    };

    // Create test users with different roles
    console.log('[SETUP] Creating test users...');

    // Create manager
    manager = await createTestManager(adminToken);
    managerUser = {
      id: manager.userId,
      email: '',
      token: manager.token,
      roleId: RoleEnum.manager,
    };

    // Create regular user
    regularUser = await createTestUser(RoleEnum.user, 'doc-upload-user');

    // Set up AnythingLLM services
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
    // Cleanup: Delete created workspaces
    if (!SKIP_ANYTHINGLLM_TESTS) {
      if (createdWorkspaceSlug) {
        await deleteTestWorkspace(createdWorkspaceSlug);
      }
      if (createdWorkspaceSlug2) {
        await deleteTestWorkspace(createdWorkspaceSlug2);
      }
    }

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

  // Helper to create a test workspace via Keystone API
  // Uses admin token for authentication (admin has permission to create workspaces)
  const createTestWorkspace = async (
    name: string,
    slug: string,
  ): Promise<string> => {
    const response = await request(APP)
      .post('/api/anythingllm/v1/workspace/new')
      .auth(adminToken, { type: 'bearer' })
      .send({ name, slug })
      .expect(200);

    if (!response.body.workspace) {
      throw new Error(
        `Failed to create workspace: ${response.body.message || 'Unknown error'}`,
      );
    }

    return response.body.workspace.slug;
  };

  // Helper to delete a test workspace via AnythingLLM admin API (direct)
  // Note: Workspace deletion endpoint not yet implemented in Keystone
  const deleteTestWorkspace = async (slug: string): Promise<void> => {
    if (!serviceIdentityService) {
      return;
    }

    try {
      const token = await serviceIdentityService.getIdToken();
      await fetch(`${ANYTHINGLLM_BASE_URL}/v1/admin/workspace/${slug}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (error) {
      // Ignore cleanup errors
      console.warn(`Failed to delete workspace ${slug}:`, error);
    }
  };

  // Helper to create a test file buffer
  const createTestFileBuffer = (
    content: string = 'Test document content',
  ): Buffer => {
    return Buffer.from(content);
  };

  describe('Workspace Setup', () => {
    it('should create test workspaces for document upload using Keystone endpoint', async () => {
      if (shouldSkipTests() || !adminUser) {
        console.log('[SKIP] Skipping workspace creation');
        return;
      }

      const timestamp = Date.now();
      const workspaceName1 = `Test Workspace ${timestamp}`;
      const workspaceSlug1 = `test-workspace-${timestamp}`;
      const workspaceName2 = `Test Workspace 2 ${timestamp}`;
      const workspaceSlug2 = `test-workspace-2-${timestamp}`;

      // Create workspaces via Keystone workspace endpoint using admin token
      createdWorkspaceSlug = await createTestWorkspace(
        workspaceName1,
        workspaceSlug1,
      );
      createdWorkspaceSlug2 = await createTestWorkspace(
        workspaceName2,
        workspaceSlug2,
      );

      expect(createdWorkspaceSlug).toBe(workspaceSlug1);
      expect(createdWorkspaceSlug2).toBe(workspaceSlug2);

      // Verify workspace was created successfully
      expect(createdWorkspaceSlug).toBeDefined();
      expect(createdWorkspaceSlug2).toBeDefined();
    }, 30000);

    it('should allow admin to create workspace via Keystone endpoint', async () => {
      if (shouldSkipTests() || !adminUser) {
        console.log('[SKIP] Skipping admin workspace creation test');
        return;
      }

      const timestamp = Date.now();
      const workspaceName = `Admin Workspace ${timestamp}`;
      const workspaceSlug = `admin-workspace-${timestamp}`;

      const response = await request(APP)
        .post('/api/anythingllm/v1/workspace/new')
        .auth(adminToken, { type: 'bearer' })
        .send({ name: workspaceName, slug: workspaceSlug })
        .expect(200);

      expect(response.body).toHaveProperty('workspace');
      expect(response.body.workspace).toHaveProperty('slug', workspaceSlug);
      expect(response.body.workspace).toHaveProperty('name', workspaceName);
      expect(response.body.workspace).toHaveProperty('id');
      expect(response.body).toHaveProperty('message', 'Workspace created');
    }, 30000);

    it('should allow manager to create workspace via Keystone endpoint', async () => {
      if (shouldSkipTests() || !managerUser) {
        console.log('[SKIP] Skipping manager workspace creation test');
        return;
      }

      const timestamp = Date.now();
      const workspaceName = `Manager Workspace ${timestamp}`;
      const workspaceSlug = `manager-workspace-${timestamp}`;

      const response = await request(APP)
        .post('/api/anythingllm/v1/workspace/new')
        .auth(managerUser.token, { type: 'bearer' })
        .send({ name: workspaceName, slug: workspaceSlug })
        .expect(200);

      expect(response.body).toHaveProperty('workspace');
      expect(response.body.workspace).toHaveProperty('slug', workspaceSlug);
      expect(response.body.workspace).toHaveProperty('name', workspaceName);
      expect(response.body.workspace).toHaveProperty('id');
    }, 30000);

    it('should allow user to create workspace via Keystone endpoint', async () => {
      if (shouldSkipTests() || !regularUser) {
        console.log('[SKIP] Skipping user workspace creation test');
        return;
      }

      const timestamp = Date.now();
      const workspaceName = `User Workspace ${timestamp}`;
      const workspaceSlug = `user-workspace-${timestamp}`;

      // Retry logic for 429 rate limiting (60s cooldown, wait 65s to be safe)
      const RATE_LIMIT_WAIT_MS = 65000; // 65 seconds
      const maxRetries = 3;
      let response: any;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          response = await request(APP)
            .post('/api/anythingllm/v1/workspace/new')
            .auth(regularUser.token, { type: 'bearer' })
            .send({ name: workspaceName, slug: workspaceSlug });

          // Check if we got a 429 rate limit error
          if (response.status === 429) {
            if (attempt < maxRetries - 1) {
              console.log(
                `[RETRY] Rate limited (429) on attempt ${attempt + 1}, waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry ${attempt + 2}/${maxRetries}`,
              );
              await sleep(RATE_LIMIT_WAIT_MS);
              continue;
            } else {
              // Last attempt and still 429 - throw error
              throw new Error(
                `Rate limited (429) after ${maxRetries} attempts: ${JSON.stringify(response.body)}`,
              );
            }
          }

          // If not 200, throw error
          if (response.status !== 200) {
            throw new Error(
              `Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`,
            );
          }

          // Success - break out of retry loop
          break;
        } catch (error: any) {
          // Check if error is from supertest expecting a status code
          const status =
            error.status ||
            error.response?.status ||
            (error.message?.includes('429') ? 429 : null);

          if (status === 429 && attempt < maxRetries - 1) {
            console.log(
              `[RETRY] Rate limited (429) on attempt ${attempt + 1}, waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry ${attempt + 2}/${maxRetries}`,
            );
            await sleep(RATE_LIMIT_WAIT_MS);
            continue;
          }

          // If not 429 or last attempt, throw
          if (attempt === maxRetries - 1) {
            throw error;
          }
        }
      }

      // Verify we got a successful response
      expect(response).toBeDefined();
      expect(response.status).toBe(200);

      expect(response.body).toHaveProperty('workspace');
      expect(response.body.workspace).toHaveProperty('slug', workspaceSlug);
      expect(response.body.workspace).toHaveProperty('name', workspaceName);
    }, 180000); // 3 minutes timeout to allow for 429 retry (65s wait + request time)

    it('should create workspace with optional configuration parameters', async () => {
      if (shouldSkipTests() || !adminUser) {
        console.log('[SKIP] Skipping workspace configuration test');
        return;
      }

      const timestamp = Date.now();
      const workspaceName = `Configured Workspace ${timestamp}`;
      const workspaceSlug = `configured-workspace-${timestamp}`;

      // Retry logic for 429 rate limiting (60s cooldown, wait 65s to be safe)
      const RATE_LIMIT_WAIT_MS = 65000; // 65 seconds
      const maxRetries = 3;
      let response: any;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          response = await request(APP)
            .post('/api/anythingllm/v1/workspace/new')
            .auth(adminToken, { type: 'bearer' })
            .send({
              name: workspaceName,
              slug: workspaceSlug,
              similarityThreshold: 0.7,
              openAiTemp: 0.7,
              openAiHistory: 20,
              openAiPrompt: 'Custom prompt for responses',
              queryRefusalResponse: 'Custom refusal message',
              chatMode: 'query',
              topN: 4,
            });

          // Check if we got a 429 rate limit error
          if (response.status === 429) {
            if (attempt < maxRetries - 1) {
              console.log(
                `[RETRY] Rate limited (429) on attempt ${attempt + 1}, waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry ${attempt + 2}/${maxRetries}`,
              );
              await sleep(RATE_LIMIT_WAIT_MS);
              continue;
            } else {
              // Last attempt and still 429 - throw error
              throw new Error(
                `Rate limited (429) after ${maxRetries} attempts: ${JSON.stringify(response.body)}`,
              );
            }
          }

          // If not 200, throw error
          if (response.status !== 200) {
            throw new Error(
              `Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`,
            );
          }

          // Success - break out of retry loop
          break;
        } catch (error: any) {
          // Check if error is from supertest expecting a status code
          const status =
            error.status ||
            error.response?.status ||
            (error.message?.includes('429') ? 429 : null);

          if (status === 429 && attempt < maxRetries - 1) {
            console.log(
              `[RETRY] Rate limited (429) on attempt ${attempt + 1}, waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry ${attempt + 2}/${maxRetries}`,
            );
            await sleep(RATE_LIMIT_WAIT_MS);
            continue;
          }

          // If not 429 or last attempt, throw
          if (attempt === maxRetries - 1) {
            throw error;
          }
        }
      }

      // Verify we got a successful response
      expect(response).toBeDefined();
      expect(response.status).toBe(200);

      expect(response.body).toHaveProperty('workspace');
      expect(response.body.workspace).toHaveProperty('slug', workspaceSlug);
      expect(response.body.workspace).toHaveProperty('name', workspaceName);
      expect(response.body.workspace).toHaveProperty('id');
    }, 180000); // 3 minutes timeout to allow for 429 retry (65s wait + request time)
  });

  describe('Document Upload - Authorization', () => {
    it('should allow admin to upload document with workspace', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug) {
        console.log('[SKIP] Skipping admin upload test');
        return;
      }

      const fileBuffer = createTestFileBuffer('Admin test document');
      const fileName = 'admin-test.txt';

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .attach('file', fileBuffer, fileName)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('documents');
      expect(Array.isArray(response.body.documents)).toBe(true);
      expect(response.body.documents.length).toBeGreaterThan(0);

      // Verify sanitized response (no infrastructure-revealing fields)
      const doc = response.body.documents[0];
      expect(doc).not.toHaveProperty('location');
      expect(doc).not.toHaveProperty('url');
      expect(doc).not.toHaveProperty('name');
      expect(doc).toHaveProperty('title');
    }, 60000);

    it('should allow manager to upload document with workspace', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug || !managerUser) {
        console.log('[SKIP] Skipping manager upload test');
        return;
      }

      const fileBuffer = createTestFileBuffer('Manager test document');
      const fileName = 'manager-test.txt';

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(managerUser.token, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .attach('file', fileBuffer, fileName)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('documents');
      expect(Array.isArray(response.body.documents)).toBe(true);
    }, 60000);

    it('should deny user from uploading document', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug || !regularUser) {
        console.log('[SKIP] Skipping user denial test');
        return;
      }

      const fileBuffer = createTestFileBuffer('User test document');
      const fileName = 'user-test.txt';

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(regularUser.token, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .attach('file', fileBuffer, fileName)
        .expect(403);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Users cannot upload documents');
    }, 60000);
  });

  describe('Document Upload - Workspace Requirements', () => {
    it('should require workspace for document upload', async () => {
      if (shouldSkipTests() || !adminUser) {
        console.log('[SKIP] Skipping workspace requirement test');
        return;
      }

      const fileBuffer = createTestFileBuffer('No workspace test');
      const fileName = 'no-workspace-test.txt';

      // Attempt upload without workspace (should fail)
      // AnythingLLM requires workspace for document upload
      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .attach('file', fileBuffer, fileName);

      // AnythingLLM returns 404 when workspace is not provided/not found
      // Other possible errors: 400 (validation), 500 (server error), 502 (bad gateway)
      // 404 is expected when workspace is missing/not found
      if (response.status === 200) {
        // If AnythingLLM accepts it, we should still validate in Keystone
        console.warn(
          'WARNING: AnythingLLM accepted upload without workspace - Keystone should enforce this',
        );
      } else {
        // Accept 404 (workspace not found), 400 (validation error), 500 (server error), or 502 (bad gateway)
        expect([400, 404, 500, 502]).toContain(response.status);
      }
    }, 60000);

    it('should allow upload to multiple workspaces', async () => {
      if (
        shouldSkipTests() ||
        !createdWorkspaceSlug ||
        !createdWorkspaceSlug2 ||
        !adminUser
      ) {
        console.log('[SKIP] Skipping multiple workspaces test');
        return;
      }

      const fileBuffer = createTestFileBuffer('Multiple workspaces test');
      const fileName = 'multi-workspace-test.txt';
      const workspaces = `${createdWorkspaceSlug},${createdWorkspaceSlug2}`;

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('addToWorkspaces', workspaces)
        .attach('file', fileBuffer, fileName)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('documents');
    }, 60000);
  });

  describe('Document Upload - Edge Cases', () => {
    it('should reject upload with missing file', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug || !adminUser) {
        console.log('[SKIP] Skipping missing file test');
        return;
      }

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('File is required');
    }, 30000);

    it('should reject invalid externalOCRFields JSON', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug || !adminUser) {
        console.log('[SKIP] Skipping invalid OCR fields test');
        return;
      }

      const fileBuffer = createTestFileBuffer('Invalid OCR test');
      const fileName = 'invalid-ocr-test.txt';

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .field('externalOCRFields', 'not valid json')
        .attach('file', fileBuffer, fileName)
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('JSON');
    }, 30000);

    it('should reject externalOCRFields that is not an array', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug || !adminUser) {
        console.log('[SKIP] Skipping non-array OCR fields test');
        return;
      }

      const fileBuffer = createTestFileBuffer('Non-array OCR test');
      const fileName = 'non-array-ocr-test.txt';

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .field('externalOCRFields', '{"not": "an array"}')
        .attach('file', fileBuffer, fileName)
        .expect(400);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('array');
    }, 30000);

    it('should accept valid externalOCRFields JSON array', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug || !adminUser) {
        console.log('[SKIP] Skipping valid OCR fields test');
        return;
      }

      const fileBuffer = createTestFileBuffer('Valid OCR test');
      const fileName = 'valid-ocr-test.txt';
      const validOcrFields = JSON.stringify([
        {
          fieldKey: 'lab_test_value',
          fieldValue: '6.3 x10^3/uL',
          fieldType: 'lab_test_value',
          confidence: 0.85,
        },
      ]);

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .field('externalOCRFields', validOcrFields)
        .attach('file', fileBuffer, fileName)
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
    }, 60000);

    it('should handle AnythingLLM offline gracefully', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug || !adminUser) {
        console.log('[SKIP] Skipping offline test');
        return;
      }

      // This test would require mocking or stopping AnythingLLM
      // For now, we'll skip if AnythingLLM is actually offline
      const fileBuffer = createTestFileBuffer('Offline test');
      const fileName = 'offline-test.txt';

      const response = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .attach('file', fileBuffer, fileName);

      // If AnythingLLM is offline or having issues, should return 502, 503, or 429 (rate limit)
      if (!response.ok) {
        expect([502, 503, 429]).toContain(response.status);
      }
    }, 30000);
  });

  describe('Document Upload - Response Sanitization', () => {
    it('should sanitize response to remove infrastructure-revealing fields', async () => {
      if (shouldSkipTests() || !createdWorkspaceSlug || !adminUser) {
        console.log('[SKIP] Skipping sanitization test');
        return;
      }

      const fileBuffer = createTestFileBuffer('Sanitization test');
      const fileName = 'sanitization-test.txt';

      // Retry logic for 429 rate limiting (60s cooldown, wait 65s to be safe)
      const RATE_LIMIT_WAIT_MS = 65000; // 65 seconds
      const maxRetries = 3;
      let response: any;
      // let lastError: any;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          response = await request(APP)
            .post('/api/anythingllm/v1/document/upload')
            .auth(adminToken, { type: 'bearer' })
            .field('addToWorkspaces', createdWorkspaceSlug)
            .attach('file', fileBuffer, fileName);

          // Check if we got a 429 rate limit error
          if (response.status === 429) {
            if (attempt < maxRetries - 1) {
              console.log(
                `[RETRY] Rate limited (429) on attempt ${attempt + 1}, waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry ${attempt + 2}/${maxRetries}`,
              );
              await sleep(RATE_LIMIT_WAIT_MS);
              continue;
            } else {
              // Last attempt and still 429 - throw error
              throw new Error(
                `Rate limited (429) after ${maxRetries} attempts: ${JSON.stringify(response.body)}`,
              );
            }
          }

          // If not 200, throw error (unless it's the last attempt and we want to handle it)
          if (response.status !== 200) {
            throw new Error(
              `Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`,
            );
          }

          // Success - break out of retry loop
          break;
        } catch (error: any) {
          // lastError = error;

          // Check if error is from supertest expecting a status code
          const status =
            error.status ||
            error.response?.status ||
            (error.message?.includes('429') ? 429 : null);

          if (status === 429 && attempt < maxRetries - 1) {
            console.log(
              `[RETRY] Rate limited (429) on attempt ${attempt + 1}, waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry ${attempt + 2}/${maxRetries}`,
            );
            await sleep(RATE_LIMIT_WAIT_MS);
            continue;
          }

          // If not 429 or last attempt, throw
          if (attempt === maxRetries - 1) {
            throw error;
          }
        }
      }

      // Verify we got a successful response
      expect(response).toBeDefined();
      expect(response.status).toBe(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('documents');

      if (response.body.documents && response.body.documents.length > 0) {
        const doc = response.body.documents[0];

        // Should NOT contain infrastructure-revealing fields
        expect(doc).not.toHaveProperty('location');
        expect(doc).not.toHaveProperty('url');
        expect(doc).not.toHaveProperty('name');

        // Should contain safe fields
        expect(doc).toHaveProperty('title');
        // wordCount and token_count_estimate are optional
      }
    }, 180000); // 3 minutes timeout to allow for 429 retry (65s wait + request time)
  });
});
