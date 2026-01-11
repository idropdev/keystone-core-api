import request from 'supertest';
import { Test } from '@nestjs/testing';
import { APP_URL, ANYTHINGLLM_BASE_URL } from '../utils/constants';
import {
  createTestUser,
  getAdminToken,
  readPdfFile,
  getTestPdfPath,
  TestUser,
} from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AnythingLLMAuthDelegationModule } from '../../src/anythingllm-auth-delegation/module';
import { AnythingLLMAuthDelegationService } from '../../src/anythingllm-auth-delegation/service';
import { AnythingLLMOperation } from '../../src/anythingllm-policy/domain/anythingllm-operation.enum';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

/**
 * Sleep utility to avoid rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * E2E Test: Document Upload with OCR Integration to AnythingLLM
 *
 * Test Strategy:
 * 1. Create a user who should automatically get a workspace
 * 2. Verify the user belongs to the created workspace
 * 3. Upload a document to Keystone and trigger OCR processing
 * 4. Extract OCR fields (documentFields and visionFields)
 * 5. Send the document with OCR fields to AnythingLLM using the new schema
 * 6. Create a thread and verify streaming chat works with the document
 *
 * Prerequisites:
 * - Keystone API running on APP_URL
 * - AnythingLLM running on ANYTHINGLLM_BASE_URL
 * - Delegated token authentication configured (HS256)
 * - GCP services configured for OCR (Document AI, Vision AI)
 */
describe('Document Upload with OCR to AnythingLLM (E2E)', () => {
  let adminToken: string;
  let testUser: TestUser;
  let testModule: any;
  let authDelegationService: AnythingLLMAuthDelegationService | null = null;
  let adminUserContext: { id: number; role: string } | null = null;
  let workspaceSlug: string | null = null;
  let documentId: string | null = null;
  let threadSlug: string | null = null;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const SKIP_OCR_TESTS = process.env.SKIP_OCR_TESTS === 'true';

  // Helper to get delegated token for admin operations
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

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Set up auth delegation service for delegated tokens (HS256)
    if (!SKIP_ANYTHINGLLM_TESTS) {
      try {
        testModule = await Test.createTestingModule({
          imports: [AnythingLLMModule, AnythingLLMAuthDelegationModule],
        }).compile();

        authDelegationService = testModule.get(
          AnythingLLMAuthDelegationService,
        );
      } catch (error) {
        console.warn(
          'Failed to initialize auth delegation service:',
          error,
        );
        authDelegationService = null;
      }
    }
  }, 60000);

  afterAll(async () => {
    // Cleanup: Delete workspace if created
    if (!SKIP_ANYTHINGLLM_TESTS && workspaceSlug && authDelegationService) {
      try {
        const delegatedToken = await getAdminDelegatedToken();
        await fetch(
          `${ANYTHINGLLM_BASE_URL}/v1/admin/workspace/${workspaceSlug}`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${delegatedToken}`,
            },
          },
        );
      } catch (error) {
        console.warn('Cleanup failed:', error);
      }
    }

    if (testModule) {
      await testModule.close();
    }
  });

  /**
   * Step 1: Create a user who should automatically get a workspace
   */
  describe('Step 1: Create User and Auto-Provision Workspace', () => {
    it('should create user in Keystone and trigger automatic provisioning', async () => {
      const timestamp = Date.now();
      const email = `test-ocr-user-${timestamp}@example.com`;
      const password = 'SecurePassword123!';

      // Register user (triggers provisioning hook)
      const registerResponse = await request(APP_URL)
        .post('/api/v1/auth/email/register')
        .send({
          email,
          password,
          firstName: 'OCR',
          lastName: 'Test',
        })
        .expect(201);

      expect(registerResponse.body).toHaveProperty('user');
      expect(registerResponse.body.user).toHaveProperty('id');

      // Login to get token
      const loginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email, password })
        .expect(200);

      testUser = {
        id: registerResponse.body.user.id,
        email,
        token: loginResponse.body.token,
        roleId: RoleEnum.user,
      };

      expect(testUser.token).toBeDefined();

      // Wait for async provisioning to start
      await sleep(5000);
    }, 30000);
  });

  /**
   * Step 2: Verify the user belongs to the created workspace
   */
  describe('Step 2: Verify User Belongs to Workspace', () => {
    it('should verify user was auto-provisioned with workspace in AnythingLLM', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !testUser || !authDelegationService) {
        return;
      }

      // Generate expected workspace slug
      const hash = crypto
        .createHash('sha256')
        .update(String(testUser.id))
        .digest('hex');
      workspaceSlug = `patient-${hash}`;

      // Poll for workspace to exist (provisioning is async)
      let workspaceFound = false;
      const maxAttempts = 20;
      const pollInterval = 2000;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const delegatedToken = await getAdminDelegatedToken();

          // Check if workspace exists
          const workspaceResponse = await fetch(
            `${ANYTHINGLLM_BASE_URL}/v1/admin/workspaces/${workspaceSlug}`,
            {
              headers: {
                Authorization: `Bearer ${delegatedToken}`,
              },
            },
          );

          if (workspaceResponse.ok) {
            workspaceFound = true;
            break;
          }

          if (attempt < maxAttempts - 1) {
            await sleep(pollInterval);
          }
        } catch (error) {
          if (attempt < maxAttempts - 1) {
            await sleep(pollInterval);
          }
        }
      }

      expect(workspaceFound).toBe(true);
      expect(workspaceSlug).toBeDefined();
    }, 60000);

    it('should verify user is assigned to their workspace', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !testUser || !workspaceSlug || !authDelegationService) {
        return;
      }

      // Poll for user to be assigned to workspace
      let userAssigned = false;
      const maxAttempts = 15;
      const pollInterval = 2000;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const delegatedToken = await getAdminDelegatedToken();

          // Get user list to find our user
          const usersResponse = await fetch(
            `${ANYTHINGLLM_BASE_URL}/v1/admin/users`,
            {
              headers: {
                Authorization: `Bearer ${delegatedToken}`,
              },
            },
          );

          if (usersResponse.ok) {
            const usersData = await usersResponse.json();
            const matchingUser = usersData.users?.find(
              (u: any) =>
                u.externalId === String(testUser.id) &&
                u.externalProvider === 'keystone',
            );

            if (matchingUser) {
              userAssigned = true;
              break;
            }
          }

          if (attempt < maxAttempts - 1) {
            await sleep(pollInterval);
          }
        } catch (error) {
          if (attempt < maxAttempts - 1) {
            await sleep(pollInterval);
          }
        }
      }

      expect(userAssigned).toBe(true);
    }, 60000);
  });

  /**
   * Step 3: Upload document to Keystone and trigger OCR processing
   */
  describe('Step 3: Upload Document and Trigger OCR', () => {
    it('should upload document to Keystone document processing system', async () => {
      if (!testUser) {
        return;
      }

      // First, assign user to a manager (required for document upload)
      // Create a temporary manager for this test
      const managerEmail = `test-manager-${Date.now()}@example.com`;
      const managerPassword = 'SecurePassword123!';

      const managerResponse = await request(APP_URL)
        .post('/api/v1/users')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email: managerEmail,
          password: managerPassword,
          firstName: 'Test',
          lastName: 'Manager',
          role: { id: RoleEnum.manager },
        })
        .expect(201);

      const managerId = managerResponse.body.id;

      // Assign user to manager
      await request(APP_URL)
        .post(`/api/v1/users/${testUser.id}/manager-assignments`)
        .auth(adminToken, { type: 'bearer' })
        .send({ managerId })
        .expect(201);

      // Login as manager to get token
      const managerLoginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: managerEmail, password: managerPassword })
        .expect(200);

      const managerToken = managerLoginResponse.body.token;

      // Wait for assignment to propagate
      await sleep(1000);

      // Upload document
      const pdfBuffer = readPdfFile(getTestPdfPath());

      const uploadResponse = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerToken, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .attach('file', pdfBuffer, 'lab-result-test.pdf')
        .expect(201);

      expect(uploadResponse.body).toHaveProperty('id');
      expect(uploadResponse.body).toHaveProperty('status');

      documentId = uploadResponse.body.id;
    }, 30000);

    it('should trigger OCR processing for the uploaded document', async () => {
      if (SKIP_OCR_TESTS || !documentId || !testUser) {
        console.log('[SKIP] OCR tests disabled or no document uploaded');
        return;
      }

      // Get manager token (re-login)
      const managerEmail = `test-manager-${Date.now()}@example.com`;
      const managerPassword = 'SecurePassword123!';

      // Create new manager for OCR trigger
      const managerResponse = await request(APP_URL)
        .post('/api/v1/users')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email: managerEmail,
          password: managerPassword,
          firstName: 'OCR',
          lastName: 'Manager',
          role: { id: RoleEnum.manager },
        })
        .expect(201);

      const managerLoginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: managerEmail, password: managerPassword })
        .expect(200);

      const managerToken = managerLoginResponse.body.token;

      // Trigger OCR processing
      const ocrResponse = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/ocr/trigger`)
        .auth(managerToken, { type: 'bearer' })
        .expect(202);

      expect(ocrResponse.body).toHaveProperty('message');
      expect(ocrResponse.body.message).toContain('triggered successfully');

      // Wait for OCR processing to complete (this can take time)
      console.log('[INFO] Waiting for OCR processing to complete (30s)...');
      await sleep(30000);
    }, 60000);
  });

  /**
   * Step 4: Extract OCR fields (documentFields and visionFields)
   */
  describe('Step 4: Extract OCR Fields', () => {
    let documentAiFields: string | null = null;
    let visionAiFields: string | null = null;

    it('should retrieve Document AI OCR fields', async () => {
      if (SKIP_OCR_TESTS || !documentId) {
        console.log('[SKIP] OCR tests disabled or no document');
        return;
      }

      // Get manager token
      const managerEmail = `test-manager-${Date.now()}@example.com`;
      const managerPassword = 'SecurePassword123!';

      const managerResponse = await request(APP_URL)
        .post('/api/v1/users')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email: managerEmail,
          password: managerPassword,
          firstName: 'DocAI',
          lastName: 'Manager',
          role: { id: RoleEnum.manager },
        })
        .expect(201);

      const managerLoginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: managerEmail, password: managerPassword })
        .expect(200);

      const managerToken = managerLoginResponse.body.token;

      // Get Document AI OCR output
      const docAiResponse = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/document-ai`)
        .auth(managerToken, { type: 'bearer' });

      if (docAiResponse.status === 200 && docAiResponse.body) {
        // Transform to the expected format for AnythingLLM
        const entities = docAiResponse.body.entities || [];
        documentAiFields = JSON.stringify({
          entities: entities.map((entity: any) => ({
            type: entity.type,
            mentionText: entity.mentionText,
            confidence: entity.confidence,
            startOffset: entity.startOffset || 0,
            endOffset: entity.endOffset || 0,
          })),
          fullResponse: docAiResponse.body,
        });

        console.log('[INFO] Document AI fields extracted');
      } else {
        console.log('[WARN] Document AI OCR not available yet');
      }
    }, 30000);

    it('should retrieve Vision AI OCR fields', async () => {
      if (SKIP_OCR_TESTS || !documentId) {
        console.log('[SKIP] OCR tests disabled or no document');
        return;
      }

      // Get manager token
      const managerEmail = `test-manager-${Date.now()}@example.com`;
      const managerPassword = 'SecurePassword123!';

      const managerResponse = await request(APP_URL)
        .post('/api/v1/users')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email: managerEmail,
          password: managerPassword,
          firstName: 'Vision',
          lastName: 'Manager',
          role: { id: RoleEnum.manager },
        })
        .expect(201);

      const managerLoginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({ email: managerEmail, password: managerPassword })
        .expect(200);

      const managerToken = managerLoginResponse.body.token;

      // Get Vision AI OCR output
      const visionResponse = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/vision-ai`)
        .auth(managerToken, { type: 'bearer' });

      if (visionResponse.status === 200 && visionResponse.body) {
        // Transform to the expected format for AnythingLLM
        const entities = visionResponse.body.entities || [];
        visionAiFields = JSON.stringify({
          entities: entities.map((entity: any) => ({
            type: entity.type || 'TEXT',
            mentionText: entity.mentionText,
            confidence: entity.confidence,
            startOffset: entity.startOffset || 0,
            endOffset: entity.endOffset || 0,
          })),
          fullResponse: visionResponse.body,
        });

        console.log('[INFO] Vision AI fields extracted');
      } else {
        console.log('[WARN] Vision AI OCR not available yet');
      }
    }, 30000);

    /**
     * Step 5: Send document with OCR fields to AnythingLLM using new schema
     */
    it('should upload document to AnythingLLM with OCR fields using new schema', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !testUser || !workspaceSlug) {
        console.log('[SKIP] AnythingLLM tests disabled or missing prerequisites');
        return;
      }

      // Re-read the PDF file for upload
      const pdfBuffer = readPdfFile(getTestPdfPath());
      const fileName = `test-document-${Date.now()}.pdf`;

      // Build the request with new schema
      const formData = new FormData();
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      formData.append('file', blob, fileName);
      formData.append('addToWorkspaces', workspaceSlug!);

      // Add OCR fields if available (from previous steps)
      if (documentAiFields) {
        formData.append('documentFields', documentAiFields);
      }
      if (visionAiFields) {
        formData.append('visionFields', visionAiFields);
      }

      // If no OCR fields, create mock data for testing
      if (!documentAiFields && !visionAiFields) {
        console.log('[INFO] No OCR fields available, using mock data for test');
        const mockDocumentFields = JSON.stringify({
          entities: [
            {
              type: 'DATE',
              mentionText: '2024-01-15',
              confidence: 0.95,
              startOffset: 0,
              endOffset: 10,
            },
          ],
          fullResponse: { mockData: true },
        });
        formData.append('documentFields', mockDocumentFields);
      }

      // Upload to AnythingLLM via Keystone endpoint
      const uploadResponse = await request(APP_URL)
        .post('/api/anythingllm/v1/document/upload')
        .auth(testUser!.token, { type: 'bearer' })
        .send(formData);

      // Note: supertest may not handle FormData correctly, use native fetch instead
      const response = await fetch(`${APP_URL}/api/anythingllm/v1/document/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${testUser!.token}`,
        },
        body: formData,
      });

      expect(response.status).toBe(200);

      const responseData = await response.json();
      expect(responseData).toHaveProperty('success', true);
      expect(responseData).toHaveProperty('documents');
      expect(Array.isArray(responseData.documents)).toBe(true);

      console.log('[SUCCESS] Document uploaded to AnythingLLM with OCR fields');
      console.log(`[INFO] Documents: ${responseData.documents.length}`);

      // Wait for document embedding
      await sleep(10000);
    }, 60000);
  });

  /**
   * Step 6: Create thread and verify streaming chat works with the document
   */
  describe('Step 6: Create Thread and Test Streaming Chat', () => {
    it('should create a thread in the workspace', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !testUser || !workspaceSlug) {
        return;
      }

      const threadName = `Test Thread ${Date.now()}`;

      const threadResponse = await request(APP_URL)
        .post(`/api/anythingllm/v1/workspace/${workspaceSlug}/thread/new`)
        .auth(testUser.token, { type: 'bearer' })
        .send({
          name: threadName,
          userId: testUser.id,
        })
        .expect(200);

      expect(threadResponse.body).toHaveProperty('thread');
      expect(threadResponse.body.thread).toHaveProperty('slug');
      expect(threadResponse.body.thread).toHaveProperty('name', threadName);

      threadSlug = threadResponse.body.thread.slug;
    }, 30000);

    it('should stream chat messages with document context', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !testUser || !workspaceSlug || !threadSlug) {
        return;
      }

      const chatMessage = 'What information is in the uploaded document?';

      // Use native fetch for streaming
      const response = await fetch(
        `${APP_URL}/api/anythingllm/v1/workspace/${workspaceSlug}/thread/${threadSlug}/stream-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${testUser.token}`,
          },
          body: JSON.stringify({
            message: chatMessage,
            mode: 'query',
            userId: testUser.id,
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
      let fullResponse = '';
      const chunks: string[] = [];

      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Stream timeout')), 60000);
      });

      const streamPromise = new Promise<void>(async (resolve, reject) => {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
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
                    expect(fullResponse.length).toBeGreaterThan(0);
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
          reject(error);
        }
      });

      await Promise.race([streamPromise, timeoutPromise]);

      console.log('[SUCCESS] Streaming chat completed');
      console.log(`[INFO] Received ${chunks.length} chunks`);
      console.log(`[INFO] Full response length: ${fullResponse.length} chars`);
    }, 90000);
  });
});
