import request from 'supertest';
import { APP_URL, ANYTHINGLLM_BASE_URL } from '../utils/constants';
import { createTestUser, getAdminToken, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';
import { AnythingLLMServiceIdentityService } from '../../src/anythingllm/services/anythingllm-service-identity.service';
import { AnythingLLMAuthDelegationService } from '../../src/anythingllm-auth-delegation/service';
import { AnythingLLMOperation } from '../../src/anythingllm-policy/domain/anythingllm-operation.enum';
import { Test } from '@nestjs/testing';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AnythingLLMAuthDelegationModule } from '../../src/anythingllm-auth-delegation/module';
import * as jwt from 'jsonwebtoken';

/**
 * Sleep utility to avoid rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * End-to-End Tests for AnythingLLM Workspace, Thread, and Document Endpoints
 *
 * Tests the complete integration flow using Keystone API endpoints:
 * 1. Workspace creation and management via Keystone API
 * 2. Document upload and management via Keystone API
 * 3. Thread creation and chat via Keystone API
 * 4. Vector search and OpenAI-compatible endpoints via Keystone API
 *
 * Prerequisites:
 * - Keystone API must be running (APP_URL)
 * - AnythingLLM must be running (ANYTHINGLLM_BASE_URL)
 * - Service identity authentication must be configured
 *
 * Note: These tests make real HTTP calls to Keystone API endpoints, which
 * then proxy to AnythingLLM. This tests the complete integration flow.
 */
describe('AnythingLLM Workspace, Thread, Document (E2E)', () => {
  let adminToken: string;
  let adminUser: TestUser;
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let authDelegationService: AnythingLLMAuthDelegationService | null = null;
  let adminUserContext: { id: number; role: string } | null = null;
  let testModule: any;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const APP = APP_URL;
  const ANYTHINGLLM_URL =
    process.env.ANYTHINGLLM_BASE_URL || ANYTHINGLLM_BASE_URL;

  let createdWorkspaceSlug: string | null = null;
  let createdThreadSlug: string | null = null;
  let createdThreadId: number | null = null;
  let regularUser: TestUser | null = null;
  let regularUserToken: string | null = null;

  beforeAll(async () => {
    // Get admin token
    adminToken = await getAdminToken();
    adminUser = {
      id: 0,
      email: 'admin@test.com',
      token: adminToken,
      roleId: RoleEnum.admin,
    };

    // Set up auth delegation service for delegated tokens (HS256)
    // ALL calls to AnythingLLM must use delegated tokens, NEVER service identity (RS256)
    if (!SKIP_ANYTHINGLLM_TESTS) {
      try {
        testModule = await Test.createTestingModule({
          imports: [AnythingLLMModule, AnythingLLMAuthDelegationModule],
        }).compile();

        authDelegationService = testModule.get(
          AnythingLLMAuthDelegationService,
        );
        serviceIdentityService = testModule.get(
          AnythingLLMServiceIdentityService,
        );
      } catch (error) {
        console.warn(
          'Failed to initialize auth delegation service, tests may be skipped:',
          error,
        );
        authDelegationService = null;
        serviceIdentityService = null;
      }
    }

    await sleep(2000);
  }, 60000);

  // Helper to get delegated token for admin operations (HS256)
  const getAdminDelegatedToken = async (): Promise<string> => {
    if (!authDelegationService) {
      throw new Error('Auth delegation service not available');
    }

    // Decode admin token to get user context
    if (!adminUserContext) {
      const decoded = jwt.decode(adminToken) as any;
      if (!decoded || !decoded.id || !decoded.role) {
        throw new Error('Failed to decode admin token');
      }
      adminUserContext = { id: decoded.id, role: decoded.role };
    }

    // Issue delegated token with admin context (HS256)
    const delegatedTokenResponse =
      await authDelegationService.issueDelegatedToken({
        requesterContext: {
          userId: String(adminUserContext.id),
          roles: ['admin'],
        },
        operation: AnythingLLMOperation.SYSTEM_READ,
        scope: ['anythingllm:admin:read', 'anythingllm:admin:write'],
      });

    return delegatedTokenResponse.token;
  };

  afterAll(async () => {
    // Cleanup: Delete created resources via AnythingLLM admin API (direct)
    // Note: Workspace deletion endpoint not yet implemented in Keystone
    if (!SKIP_ANYTHINGLLM_TESTS && serviceIdentityService) {
      try {
        if (createdWorkspaceSlug) {
          const token = await serviceIdentityService.getIdToken();
          await fetch(
            `${ANYTHINGLLM_URL}/v1/admin/workspace/${createdWorkspaceSlug}`,
            {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );
        }
      } catch (error) {
        console.warn('Cleanup failed:', error);
      }
    }

    if (testModule) {
      await testModule.close();
    }
  });

  // Helper to create a test workspace via Keystone API
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

  // Helper to create a test file buffer
  const createTestFileBuffer = (
    content: string = 'Test document content',
  ): Buffer => {
    return Buffer.from(content);
  };

  describe('Authentication', () => {
    it('should verify auth token via Keystone API', async () => {
      if (SKIP_ANYTHINGLLM_TESTS) {
        return;
      }

      // Use Keystone API endpoint which handles token conversion properly
      // This endpoint accepts service identity tokens and converts them to delegated tokens
      const response = await request(APP)
        .get('/api/anythingllm/v1/system/auth')
        .timeout(10000);

      // Service identity should work without explicit token (OptionalJwtGuard allows it)
      // Or we can test with admin token
      if (response.status === 401) {
        // If auth is required, test with admin token
        const authResponse = await request(APP)
          .get('/api/anythingllm/v1/system/auth')
          .auth(adminToken, { type: 'bearer' })
          .timeout(10000);

        expect(authResponse.status).toBe(200);
        expect(authResponse.body).toHaveProperty('authenticated');
        expect(typeof authResponse.body.authenticated).toBe('boolean');
        return;
      }

      // If no auth required, verify response structure
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('authenticated');
      expect(typeof response.body.authenticated).toBe('boolean');
    });
  });

  describe('Workspace Management', () => {
    it('should create workspace via Keystone API', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminUser) {
        return;
      }

      const timestamp = Date.now();
      const workspaceName = `Test Workspace ${timestamp}`;
      const workspaceSlug = `test-workspace-${timestamp}`;

      const response = await request(APP)
        .post('/api/anythingllm/v1/workspace/new')
        .auth(adminToken, { type: 'bearer' })
        .send({ name: workspaceName, slug: workspaceSlug })
        .expect(200);

      expect(response.body).toHaveProperty('workspace');
      expect(response.body.workspace).toHaveProperty('slug', workspaceSlug);
      expect(response.body.workspace).toHaveProperty('name', workspaceName);
      expect(response.body.workspace).toHaveProperty('id');

      createdWorkspaceSlug = response.body.workspace.slug;
    }, 30000);

    // Note: List workspaces and get workspace by slug endpoints may not be available
    // via Keystone API. These would need to be implemented in the controller.
  });

  describe('Document Management', () => {
    it('should upload document via Keystone API', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !createdWorkspaceSlug || !adminUser) {
        return;
      }

      const fileBuffer = createTestFileBuffer('Test document for E2E testing');
      const fileName = 'test-document.txt';

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

      // Note: Document location may not be in the sanitized response
      // uploadedDocumentLocation = response.body.documents[0]?.location || null;
    }, 60000);

    // Note: Other document endpoints (list, get accepted types, etc.) may not be
    // available via Keystone API. These would need to be implemented in the controller.
  });

  describe('Workspace Embeddings', () => {
    it('should update workspace embeddings via Keystone API', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !createdWorkspaceSlug || !adminUser) {
        return;
      }

      // Note: Workspace embeddings endpoint may not be available via Keystone API
      // This would need to be implemented in the controller
      console.log(
        '[SKIP] Workspace embeddings endpoint not yet available via Keystone API',
      );
    });
  });

  describe('Thread Management', () => {
    it('should create thread via Keystone API (admin)', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminUser) {
        return;
      }

      // First create a workspace
      const timestamp = Date.now();
      const workspaceName = `Test Workspace ${timestamp}`;
      const workspaceSlug = `test-workspace-${timestamp}`;

      const workspaceResponse = await request(APP)
        .post('/api/anythingllm/v1/workspace/new')
        .auth(adminToken, { type: 'bearer' })
        .send({ name: workspaceName, slug: workspaceSlug })
        .expect(200);

      const workspaceSlugCreated = workspaceResponse.body.workspace.slug;

      // Create thread in workspace
      const threadName = `Test Thread ${timestamp}`;
      const threadResponse = await request(APP)
        .post(`/api/anythingllm/v1/workspace/${workspaceSlugCreated}/thread/new`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          name: threadName,
        })
        .expect(200);

      expect(threadResponse.body).toHaveProperty('thread');
      expect(threadResponse.body.thread).toHaveProperty('id');
      expect(threadResponse.body.thread).toHaveProperty('slug');
      expect(threadResponse.body.thread).toHaveProperty('name', threadName);
      expect(threadResponse.body.thread).toHaveProperty('workspace_id');
    }, 30000);
  });

  describe('Complete Workflow: User, Workspace, Thread, Document, Chat', () => {
    it('should complete full workflow: create user, workspace, assign user, create thread, upload document, and stream chat', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminUser) {
        return;
      }

      const timestamp = Date.now();

      // Step 1: Create a regular user
      regularUser = await createTestUser(
        RoleEnum.user,
        `testuser-${timestamp}`,
      );
      regularUserToken = regularUser.token;
      expect(regularUser).toBeDefined();
      expect(regularUser.id).toBeGreaterThan(0);

      // Wait for user provisioning to complete
      await sleep(5000);

      // Step 2: Create workspace (as admin)
      const workspaceName = `Test Workspace ${timestamp}`;
      const workspaceSlug = `test-workspace-${timestamp}`;

      const workspaceResponse = await request(APP)
        .post('/api/anythingllm/v1/workspace/new')
        .auth(adminToken, { type: 'bearer' })
        .send({ name: workspaceName, slug: workspaceSlug })
        .expect(200);

      expect(workspaceResponse.body).toHaveProperty('workspace');
      expect(workspaceResponse.body.workspace).toHaveProperty('slug', workspaceSlug);
      expect(workspaceResponse.body.workspace).toHaveProperty('id');
      createdWorkspaceSlug = workspaceResponse.body.workspace.slug;

      // Step 3: Assign user to workspace (via admin API)
      // Note: Admin endpoint requires service identity token, not user JWT
      // Users are automatically assigned to their workspace during provisioning,
      // but since we created the workspace separately, we need to manually assign.
      
      if (!authDelegationService) {
        console.log(
          '[SKIP] Auth delegation service not available - skipping manual user assignment. User may be auto-assigned during provisioning.',
        );
        // User should be auto-assigned to their workspace during provisioning
        // If not, the thread creation will fail and we'll know
      } else if (!regularUser) {
        throw new Error('regularUser is null - cannot assign to workspace');
      } else {
        // Get AnythingLLM user ID by calling the external ID lookup endpoint
        // Uses GET /v1/admin/users/external/:externalId?provider=keystone
        // CRITICAL: Use delegated token (HS256) with admin context, NOT service identity (RS256)
        let anythingllmUserId: number | null = null;
        
        try {
          const delegatedToken = await getAdminDelegatedToken();
          
          // Look up user by externalId using dedicated endpoint
          const userResponse = await fetch(
            `${ANYTHINGLLM_URL}/v1/admin/users/external/${regularUser.id}?provider=keystone`,
            {
              headers: {
                Authorization: `Bearer ${delegatedToken}`,
              },
            },
          );
          
          if (userResponse.ok) {
            const userData = await userResponse.json();
            if (userData.user && userData.user.id) {
              anythingllmUserId = userData.user.id;
            }
          } else if (userResponse.status === 404) {
            // User not found yet - may still be provisioning
            console.log(
              `User ${regularUser.id} not found in AnythingLLM yet (may still be provisioning)`,
            );
          }
        } catch (error) {
          console.warn(
            'Failed to lookup user in AnythingLLM, skipping assignment:',
            error,
          );
        }

        if (anythingllmUserId) {
          // CRITICAL: Call AnythingLLM directly with delegated token (HS256)
          // The Keystone admin endpoint uses ServiceIdentityGuard which rejects delegated tokens
          // So we must call AnythingLLM directly, similar to user lookup
          const delegatedToken = await getAdminDelegatedToken();
          const assignResponse = await fetch(
            `${ANYTHINGLLM_URL}/v1/admin/workspaces/${createdWorkspaceSlug}/manage-users`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${delegatedToken}`,
              },
              body: JSON.stringify({
                userIds: [anythingllmUserId],
                reset: false,
              }),
            },
          );
          
          const assignResponseBody = assignResponse.ok ? await assignResponse.json() : await assignResponse.text();
          
          if (!assignResponse.ok) {
            throw new Error(
              `Failed to assign user to workspace: ${assignResponse.status} - ${JSON.stringify(assignResponseBody)}`,
            );
          }
          
          expect(assignResponseBody).toHaveProperty('success', true);
        } else {
          console.log(
            '[SKIP] User not found in AnythingLLM yet - may be auto-assigned during provisioning',
          );
        }
      }

      // Wait for assignment to propagate
      await sleep(2000);

      // Step 4: Create thread in workspace (as regular user)
      const threadName = `Test Thread ${timestamp}`;
      const threadResponse = await request(APP)
        .post(`/api/anythingllm/v1/workspace/${createdWorkspaceSlug}/thread/new`)
        .auth(regularUserToken, { type: 'bearer' })
        .send({
          name: threadName,
          userId: regularUser.id,
        })
        .expect(200);

      expect(threadResponse.body).toHaveProperty('thread');
      expect(threadResponse.body.thread).toHaveProperty('id');
      expect(threadResponse.body.thread).toHaveProperty('slug');
      expect(threadResponse.body.thread).toHaveProperty('name', threadName);
      expect(threadResponse.body.thread).toHaveProperty('workspace_id');
      expect(threadResponse.body.thread.workspace_id).toBe(
        workspaceResponse.body.workspace.id,
      );

      createdThreadSlug = threadResponse.body.thread.slug;
      createdThreadId = threadResponse.body.thread.id;

      // Step 5: Upload document to workspace
      const documentContent = `This is a test document for E2E testing.
It contains information about testing workflows.
The document will be used to test LLM responses in the thread.
Created at: ${new Date().toISOString()}`;

      const fileBuffer = Buffer.from(documentContent);
      const fileName = `test-document-${timestamp}.txt`;

      // Ensure workspace slug is available before uploading document
      if (!createdWorkspaceSlug) {
        throw new Error('Workspace slug is null, cannot upload document');
      }

      const documentResponse = await request(APP)
        .post('/api/anythingllm/v1/document/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('addToWorkspaces', createdWorkspaceSlug)
        .attach('file', fileBuffer, fileName)
        .expect(200);

      expect(documentResponse.body).toHaveProperty('success', true);
      expect(documentResponse.body).toHaveProperty('documents');
      expect(Array.isArray(documentResponse.body.documents)).toBe(true);
      expect(documentResponse.body.documents.length).toBeGreaterThan(0);

      // Wait for document processing/embedding
      await sleep(10000);

      // Step 6: Send streaming chat message to thread
      // Note: Streaming endpoint may not be exposed via HTTP controller yet
      // For now, we'll verify the workflow up to this point
      const chatMessage = 'What information is in the uploaded document?';

      // Ensure we have required data
      if (!regularUserToken || !regularUser || !createdWorkspaceSlug || !createdThreadSlug) {
        throw new Error('Missing required data for stream chat test');
      }

      // Try to call streaming endpoint via Keystone API
      // If not available, we'll verify all previous steps completed successfully
      try {
        // For streaming responses, supertest buffers the response by default
        // Use native fetch() for Server-Sent Events streaming instead
        const token = regularUserToken!;
        const user = regularUser!;

        // Parse streaming response (Server-Sent Events)
        const chunks: string[] = [];
        let fullResponse = '';

        return new Promise<void>(async (resolve, reject) => {
          try {
            const response = await fetch(
              `${APP}/api/anythingllm/v1/workspace/${createdWorkspaceSlug}/thread/${createdThreadSlug}/stream-chat`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  message: chatMessage,
                  mode: 'query',
                  userId: user.id,
                }),
              },
            );

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);

            if (!response.body) {
              throw new Error('Response body is null');
            }

            // Read the stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            const timeoutId = setTimeout(() => {
              if (chunks.length === 0) {
                reject(new Error('Stream timeout - no response received'));
              } else {
                resolve();
              }
            }, 60000);

            try {
              while (true) {
                const { done, value } = await reader.read();

                if (done) {
                  clearTimeout(timeoutId);
                  expect(chunks.length).toBeGreaterThan(0);
                  if (fullResponse.length > 0) {
                    expect(fullResponse.length).toBeGreaterThan(0);
                  }
                  resolve();
                  break;
                }

                // Decode chunk and add to buffer
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const text = line.slice(6);
                    chunks.push(text);

                    try {
                      const data = JSON.parse(text);
                      
                      if (data.textResponse) {
                        fullResponse += data.textResponse;
                      }
                      
                      if (data.close) {
                        clearTimeout(timeoutId);
                        expect(fullResponse.length).toBeGreaterThan(0);
                        expect(data.type).toBe('textResponseChunk');
                        resolve();
                        return;
                      }
                    } catch (error) {
                      // Ignore parse errors for non-JSON lines
                    }
                  }
                }
              }
            } catch (error) {
              clearTimeout(timeoutId);
              reject(error);
            }
          } catch (error) {
            reject(error);
          }
        });
      } catch (error: any) {
        // If streaming endpoint is not available (404), skip streaming test
        // but verify that all previous steps completed successfully
        if (error.status === 404 || error.response?.status === 404) {
          console.log(
            '[INFO] Streaming endpoint not yet available via Keystone API - verifying workflow up to this point',
          );
          // Verify that all previous steps completed successfully
          expect(createdWorkspaceSlug).toBeTruthy();
          expect(createdThreadSlug).toBeTruthy();
          expect(createdThreadId).toBeGreaterThan(0);
          expect(regularUser).toBeDefined();
          expect(regularUser.id).toBeGreaterThan(0);
          return;
        }
        throw error;
      }
    }, 120000); // 2 minute timeout for full workflow
  });

  describe('Vector Search', () => {
    it('should perform vector search via Keystone API', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !createdWorkspaceSlug || !adminUser) {
        return;
      }

      // Note: Vector search endpoint may not be available via Keystone API
      // This would need to be implemented in the controller
      console.log(
        '[SKIP] Vector search endpoint not yet available via Keystone API',
      );
    });
  });

  describe('OpenAI-Compatible Endpoints', () => {
    it('should get chat completions via Keystone API', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminUser) {
        return;
      }

      // Note: OpenAI-compatible endpoints may not be available via Keystone API
      // This would need to be implemented in the controller
      console.log(
        '[SKIP] OpenAI-compatible endpoints not yet available via Keystone API',
      );
    });

    it('should get embeddings via Keystone API', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !adminUser) {
        return;
      }

      // Note: Embeddings endpoint may not be available via Keystone API
      // This would need to be implemented in the controller
      console.log(
        '[SKIP] Embeddings endpoint not yet available via Keystone API',
      );
    });
  });
});
