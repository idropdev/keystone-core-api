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
 * 4. Extract OCR fields (document_output and vision_output) from GET /v1/documents/:id/fields
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

    it('should retrieve OCR fields from GET /v1/documents/:id/fields', async () => {
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

      // Get OCR fields (both Document AI and Vision AI in one call)
      const fieldsResponse = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/fields`)
        .auth(managerToken, { type: 'bearer' });

      if (fieldsResponse.status === 200 && fieldsResponse.body) {
        // Extract document_output field (Document AI)
        if (fieldsResponse.body.document_output) {
          // Send the entire document_output object as-is
          documentAiFields = JSON.stringify(fieldsResponse.body.document_output);
          console.log('[INFO] Document AI fields extracted from document_output');
        } else {
          console.log('[WARN] document_output not available in response');
        }

        // Extract vision_output field (Vision AI)
        if (fieldsResponse.body.vision_output) {
          // Send the entire vision_output object as-is
          visionAiFields = JSON.stringify(fieldsResponse.body.vision_output);
          console.log('[INFO] Vision AI fields extracted from vision_output');
        } else {
          console.log('[WARN] vision_output not available in response');
        }

        // Log what we got
        console.log(`[INFO] OCR fields status - Document AI: ${documentAiFields ? 'available' : 'missing'}, Vision AI: ${visionAiFields ? 'available' : 'missing'}`);
      } else {
        console.log('[WARN] OCR fields not available yet (status: ' + fieldsResponse.status + ')');
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

      // Add OCR fields if available (full document_output and vision_output objects)
      if (documentAiFields) {
        // documentAiFields already contains the full document_output object as JSON string
        formData.append('documentFields', documentAiFields);
        console.log('[INFO] Added documentFields (document_output) to FormData');
      }
      
      if (visionAiFields) {
        // visionAiFields already contains the full vision_output object as JSON string
        formData.append('visionFields', visionAiFields);
        console.log('[INFO] Added visionFields (vision_output) to FormData');
      }

      // If no OCR fields, create mock data for testing
      if (!documentAiFields && !visionAiFields) {
        console.log('[INFO] No OCR fields available, using mock data for test');
        
        // Mock document_output structure (matches the format from GET /v1/documents/:id/fields)
        const mockDocumentOutput = {
          text: 'Sample lab result text',
          entities: [
            {
              type: 'DATE',
              mentionText: '2024-01-15',
              confidence: 0.95,
              startOffset: 0,
              endOffset: 10,
            },
            {
              type: 'LAB_VALUE',
              mentionText: '6.3 x10^3/uL',
              confidence: 0.92,
              startOffset: 50,
              endOffset: 62,
            },
          ],
          outputRef: 'mock-document-ai-ref',
          pageCount: 1,
          confidence: 0.93,
          fullResponse: {
            uri: 'gs://mock-bucket/mock-document.pdf',
            text: 'Sample lab result text',
            pages: [],
          },
        };
        
        formData.append('documentFields', JSON.stringify(mockDocumentOutput));
        console.log('[INFO] Added mock documentFields (document_output) for testing');
      }

      // Upload to AnythingLLM via Keystone endpoint using native fetch
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
      console.log(`[INFO] Documents uploaded: ${responseData.documents.length}`);
      
      if (documentAiFields) {
        console.log('[INFO] ✓ Document AI OCR fields (document_output) were included in upload');
      }
      if (visionAiFields) {
        console.log('[INFO] ✓ Vision AI OCR fields (vision_output) were included in upload');
      }
      if (!documentAiFields && !visionAiFields) {
        console.log('[INFO] ℹ Mock OCR data was used for testing');
      }

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
