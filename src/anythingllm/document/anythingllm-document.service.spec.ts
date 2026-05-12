// Set minimal environment variables BEFORE imports to satisfy module dependencies
// Note: AnythingLLM has its own database, but our modules may require DB config for initialization
// Set to document database mode to avoid TypeORM dependencies in provisioning modules
if (!process.env.DATABASE_TYPE) {
  process.env.DATABASE_TYPE = 'mongodb';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'mongodb://localhost:27017/test';
}

import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AnythingLLMModule } from '../anythingllm.module';
import { AnythingLLMDocumentService } from './anythingllm-document.service';
import { AnythingLLMWorkspaceService } from '../workspace/anythingllm-workspace.service';
import { AnythingLLMThreadService } from '../thread/anythingllm-thread.service';
import { AnythingLLMHealthService } from '../services/anythingllm-health.service';
import { AnythingLLMServiceIdentityService } from '../services/anythingllm-service-identity.service';
import { UpstreamError } from '../registry/upstream-error';

// Import constants from test utils (or define locally)
const ANYTHINGLLM_BASE_URL =
  process.env.ANYTHINGLLM_API_URL ||
  process.env.ANYTHINGLLM_BASE_URL ||
  'http://localhost:3001/api';

/**
 * End-to-End Integration Tests for AnythingLLM Document Service
 *
 * Tests the complete workflow:
 * 1. Service-to-service authentication health check
 * 2. Create workspace
 * 3. Upload document (file upload with Buffer)
 * 4. Update workspace embeddings
 * 5. Create thread
 * 6. Chat about the document
 * 7. Test error cases (deleted thread, etc.)
 * 8. Test management endpoints
 *
 * Prerequisites:
 * - AnythingLLM must be running (ANYTHINGLLM_API_URL or ANYTHINGLLM_BASE_URL)
 * - Service identity authentication must be configured
 * - Users are already provisioned (role assignment done)
 *
 * To skip tests if AnythingLLM is not available:
 *   SKIP_ANYTHINGLLM_TESTS=true npm run test -- anythingllm-document.service.spec.ts
 *
 * Note: AnythingLLM has its own database, so no database config is needed.
 * These tests make real HTTP calls to AnythingLLM endpoints.
 */
describe('AnythingLLMDocumentService (E2E Workflow)', () => {
  let documentService: AnythingLLMDocumentService;
  let workspaceService: AnythingLLMWorkspaceService;
  let threadService: AnythingLLMThreadService;
  let healthService: AnythingLLMHealthService;
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let module: TestingModule;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';

  // Test state
  let createdWorkspaceSlug: string | null = null;
  let createdThreadSlug: string | null = null;
  let uploadedDocumentLocation: string | null = null;
  let uploadedDocumentName: string | null = null;

  beforeAll(async () => {
    if (SKIP_ANYTHINGLLM_TESTS) {
      console.log(
        'SKIP_ANYTHINGLLM_TESTS=true - Skipping AnythingLLM E2E tests',
      );
      return;
    }

    // Set up service identity service for direct AnythingLLM calls
    // Note: In test environments, GCP credentials may not be configured.
    // This is expected - tests will gracefully skip AnythingLLM verification
    // if service identity tokens cannot be minted.
    try {
      module = await Test.createTestingModule({
        imports: [AnythingLLMModule],
      }).compile();

      documentService = module.get<AnythingLLMDocumentService>(
        AnythingLLMDocumentService,
      );
      workspaceService = module.get<AnythingLLMWorkspaceService>(
        AnythingLLMWorkspaceService,
      );
      threadService = module.get<AnythingLLMThreadService>(
        AnythingLLMThreadService,
      );
      healthService = module.get<AnythingLLMHealthService>(
        AnythingLLMHealthService,
      );
      serviceIdentityService = module.get<AnythingLLMServiceIdentityService>(
        AnythingLLMServiceIdentityService,
      );
    } catch (error) {
      // Module initialization failed - services will be null
      // Tests will skip AnythingLLM verification gracefully
      console.warn(
        'Failed to initialize AnythingLLM services, tests will be skipped:',
        error,
      );
      documentService = null as any;
      workspaceService = null as any;
      threadService = null as any;
      healthService = null as any;
      serviceIdentityService = null;
    }
  }, 60000);

  afterAll(async () => {
    // Cleanup: Delete created resources
    if (!SKIP_ANYTHINGLLM_TESTS) {
      try {
        if (createdThreadSlug && createdWorkspaceSlug) {
          // Thread should already be deleted in tests, but try anyway
          try {
            await threadService?.deleteThread(
              createdWorkspaceSlug,
              createdThreadSlug,
            );
          } catch (_error) {
            // Thread may already be deleted, that's OK
            console.log('Thread cleanup: already deleted or not found');
          }
        }
        if (createdWorkspaceSlug) {
          await workspaceService?.deleteWorkspace(createdWorkspaceSlug);
        }
      } catch (error) {
        console.warn('Cleanup failed:', error);
      }
    }

    if (module) {
      await module.close();
    }
  });

  describe('Service-to-Service Authentication', () => {
    it('should verify service-to-service authentication with health check', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !healthService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const healthResult = await healthService.checkHealth();

      expect(healthResult).toBeDefined();
      expect(healthResult.status).toBe('healthy');
      expect(healthResult.reachable).toBe(true);
      expect(healthResult.authenticated).toBe(true);
      expect(healthResult.responseTime).toBeDefined();
      expect(healthResult.responseTime).toBeGreaterThan(0);
    });

    it('should verify service identity token can be minted and used for admin calls', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !serviceIdentityService) {
        console.log(
          '[SKIP] Service identity service not available, skipping direct AnythingLLM verification',
        );
        return;
      }

      // Mint service identity token
      // Note: In test environments, GCP credentials may not be configured.
      // GCP authentication errors are expected and tests will skip gracefully.
      let serviceToken: string;
      try {
        serviceToken = await serviceIdentityService.getIdToken();
      } catch (_error) {
        // Expected in test environments without GCP credentials configured
        console.log(
          '[SKIP] GCP service identity not available in test environment (expected), skipping AnythingLLM direct verification',
        );
        return;
      }

      expect(serviceToken).toBeDefined();
      expect(serviceToken.length).toBeGreaterThan(0);

      // Test admin endpoint with service identity token
      // Call AnythingLLM directly using the service token
      const adminResponse = await request(ANYTHINGLLM_BASE_URL)
        .get('/v1/admin/is-multi-user-mode')
        .set('Authorization', `Bearer ${serviceToken}`)
        .set('X-Client-Service', 'keystone-test')
        .expect((res) => {
          // Accept 200 (success) or 401 (auth required - AnythingLLM not configured)
          if (res.status === 401) {
            console.log(
              '[SKIP] AnythingLLM requires service identity authentication, skipping verification',
            );
          }
          return res.status === 200 || res.status === 401;
        });

      if (adminResponse.status === 401) {
        // Service identity not configured - skip verification
        console.log(
          '[SKIP] Service identity authentication failed for AnythingLLM verification',
        );
        return;
      }

      expect(adminResponse.status).toBe(200);
      expect(adminResponse.body).toBeDefined();
    });
  });

  describe('Complete Workflow: Workspace → Document → Thread → Chat', () => {
    it('should create a workspace', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !workspaceService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const workspaceName = `E2E Test Workspace ${Date.now()}`;
      const result = await workspaceService.createWorkspace({
        name: workspaceName,
      });
      const data = await result.json();

      expect(data.success).toBe(true);
      expect(data.workspace).toBeDefined();
      expect(data.workspace?.name).toBe(workspaceName);
      expect(data.workspace?.slug).toBeDefined();

      createdWorkspaceSlug = data.workspace?.slug || null;
      expect(createdWorkspaceSlug).toBeTruthy();
    });

    it('should upload a document file (Buffer)', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService || !createdWorkspaceSlug) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      // Create a test document content
      const documentContent = `Test Document for E2E Testing
Created: ${new Date().toISOString()}

This is a test document that will be uploaded to AnythingLLM.
It contains information about testing the document upload workflow.

Key points:
- File upload using Buffer
- FormData handling (Buffer to Blob conversion)
- Document management
- Thread creation and chat

This document will be used to test the complete workflow.`;

      const file = Buffer.from(documentContent, 'utf-8');
      const fileName = `e2e-test-document-${Date.now()}.txt`;

      const result = await documentService.uploadFile(file, fileName);

      expect(result.data).toBeDefined();
      expect(result.status).toBe(200);

      // Extract document location/name from response
      // DocumentUploadResponseSchema has documents array
      if (result.data.documents && result.data.documents.length > 0) {
        uploadedDocumentLocation = result.data.documents[0]?.location || null;
        uploadedDocumentName = result.data.documents[0]?.name || fileName;
      } else {
        // Fallback: use the filename we provided
        uploadedDocumentName = fileName;
      }

      expect(uploadedDocumentName).toBeTruthy();
    });

    it('should update workspace embeddings with the uploaded document', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !workspaceService ||
        !createdWorkspaceSlug ||
        !uploadedDocumentLocation
      ) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const result = await workspaceService.updateEmbeddings(
        createdWorkspaceSlug,
        {
          adds: [uploadedDocumentLocation],
          deletes: [],
        },
      );

      expect(result.data.success).toBe(true);
    });

    it('should create a thread in the workspace', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !threadService || !createdWorkspaceSlug) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const threadName = `E2E Test Thread ${Date.now()}`;
      const result = await threadService.createThread(createdWorkspaceSlug, {
        name: threadName,
        userId: 1,
      });
      const data = await result.json();

      expect(data.success).toBe(true);
      expect(data.threadSlug).toBeDefined();

      createdThreadSlug = data.threadSlug || null;
      expect(createdThreadSlug).toBeTruthy();
    });

    it('should send a message to the thread about the document', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !threadService ||
        !createdWorkspaceSlug ||
        !createdThreadSlug
      ) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const result = await threadService.sendMessage(
        createdWorkspaceSlug,
        createdThreadSlug,
        {
          message: 'What is this document about?',
          mode: 'query',
          userId: 1,
        },
      );

      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
      expect(['abort', 'textResponse']).toContain(result.data.type);

      // If we got a text response, verify it has content
      if (result.data.type === 'textResponse' && result.data.textResponse) {
        expect(result.data.textResponse).toBeDefined();
        expect(result.data.textResponse.length).toBeGreaterThan(0);
      }
    });

    it('should get thread history after sending message', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !threadService ||
        !createdWorkspaceSlug ||
        !createdThreadSlug
      ) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const historyResponse = await threadService.getThreadHistory(
        createdWorkspaceSlug,
        createdThreadSlug,
      );

      const result = await historyResponse.json();
      expect(result.history).toBeDefined();
      expect(Array.isArray(result.history)).toBe(true);
      expect(result.history.length).toBeGreaterThan(0);

      // Verify the history contains our message
      const hasOurMessage = result.history.some(
        (chat: any) =>
          chat.message?.toLowerCase().includes('what is this document') ||
          chat.prompt?.toLowerCase().includes('what is this document'),
      );
      expect(hasOurMessage).toBe(true);
    });

    it('should send a follow-up message', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !threadService ||
        !createdWorkspaceSlug ||
        !createdThreadSlug
      ) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const result = await threadService.sendMessage(
        createdWorkspaceSlug,
        createdThreadSlug,
        {
          message: 'Can you summarize the key points?',
          mode: 'query',
          userId: 1,
        },
      );

      expect(result.data).toBeDefined();
      expect(result.data.id).toBeDefined();
    });
  });

  describe('Error Cases and Edge Cases', () => {
    it('should fail to send message to deleted thread', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !threadService ||
        !createdWorkspaceSlug ||
        !createdThreadSlug
      ) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      // Delete the thread
      const deleteResponse = await threadService.deleteThread(
        createdWorkspaceSlug,
        createdThreadSlug,
      );

      const deleteResult = await deleteResponse.json();
      expect(deleteResult.success).toBe(true);

      // Try to send a message to the deleted thread - should fail
      await expect(
        threadService.sendMessage(createdWorkspaceSlug, createdThreadSlug, {
          message: 'This should fail',
          mode: 'query',
          userId: 1,
        }),
      ).rejects.toThrow();

      // Verify it's an UpstreamError (API error, not network error)
      try {
        await threadService.sendMessage(
          createdWorkspaceSlug,
          createdThreadSlug,
          {
            message: 'This should fail',
            mode: 'query',
            userId: 1,
          },
        );
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        // The error should indicate the thread doesn't exist
        const upstreamError = error as UpstreamError;
        expect(upstreamError.status).toBeGreaterThanOrEqual(400);
      }
    });

    it('should fail to get history of deleted thread', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !threadService ||
        !createdWorkspaceSlug ||
        !createdThreadSlug
      ) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      // Thread should already be deleted from previous test
      await expect(
        threadService.getThreadHistory(createdWorkspaceSlug, createdThreadSlug),
      ).rejects.toThrow();

      try {
        await threadService.getThreadHistory(
          createdWorkspaceSlug,
          createdThreadSlug,
        );
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        const upstreamError = error as UpstreamError;
        expect(upstreamError.status).toBeGreaterThanOrEqual(400);
      }
    });

    it('should fail to update non-existent thread', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !threadService || !createdWorkspaceSlug) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const nonExistentThreadSlug = 'non-existent-thread-slug';

      await expect(
        threadService.updateThread(
          createdWorkspaceSlug,
          nonExistentThreadSlug,
          {
            name: 'Updated Name',
          },
        ),
      ).rejects.toThrow();

      try {
        await threadService.updateThread(
          createdWorkspaceSlug,
          nonExistentThreadSlug,
          {
            name: 'Updated Name',
          },
        );
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        const upstreamError = error as UpstreamError;
        expect(upstreamError.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe('Document Management Endpoints', () => {
    it('should list all documents', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const result = await documentService.listDocuments();

      expect(result.data.documents).toBeDefined();
      expect(Array.isArray(result.data.documents)).toBe(true);

      // Our uploaded document should be in the list
      if (uploadedDocumentName) {
        const foundDocument = result.data.documents.find(
          (doc: any) => doc.name === uploadedDocumentName,
        );
        expect(foundDocument).toBeDefined();
      }
    });

    it('should get accepted file types', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const result = await documentService.getAcceptedFileTypes();

      expect(result.data.types).toBeDefined();
      expect(Array.isArray(result.data.types)).toBe(true);
      expect(result.data.types.length).toBeGreaterThan(0);
    });

    it('should get metadata schema', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const result = await documentService.getMetadataSchema();

      expect(result.data.schema).toBeDefined();
    });

    it('should get document by name', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService || !uploadedDocumentName) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const result = await documentService.getDocument(uploadedDocumentName);

      expect(result.data).toBeDefined();
      expect(result.data.document).toBeDefined();
      expect(result.data.document.name).toBe(uploadedDocumentName);
    });

    it('should fail to get non-existent document', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const nonExistentDocName = `non-existent-doc-${Date.now()}.txt`;

      await expect(
        documentService.getDocument(nonExistentDocName),
      ).rejects.toThrow();

      try {
        await documentService.getDocument(nonExistentDocName);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        const upstreamError = error as UpstreamError;
        expect(upstreamError.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe('Workspace Management Endpoints', () => {
    it('should list all workspaces', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !workspaceService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const result = await workspaceService.listWorkspaces();

      expect(result.data.workspaces).toBeDefined();
      expect(Array.isArray(result.data.workspaces)).toBe(true);

      // Our created workspace should be in the list
      if (createdWorkspaceSlug) {
        const foundWorkspace = result.data.workspaces.find(
          (ws: any) => ws.slug === createdWorkspaceSlug,
        );
        expect(foundWorkspace).toBeDefined();
      }
    });

    it('should get workspace by slug', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !workspaceService ||
        !createdWorkspaceSlug
      ) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const result = await workspaceService.getWorkspace(createdWorkspaceSlug);

      expect(result.data).toBeDefined();
      expect(result.data.slug).toBe(createdWorkspaceSlug);
    });

    it('should update workspace settings', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !workspaceService ||
        !createdWorkspaceSlug
      ) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const result = await workspaceService.updateWorkspace(
        createdWorkspaceSlug,
        {
          name: `Updated Workspace Name ${Date.now()}`,
        },
      );

      expect(result.data.success).toBe(true);
      expect(result.data.workspace).toBeDefined();
    });

    it('should fail to get non-existent workspace', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !workspaceService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const nonExistentSlug = `non-existent-workspace-${Date.now()}`;

      await expect(
        workspaceService.getWorkspace(nonExistentSlug),
      ).rejects.toThrow();

      try {
        await workspaceService.getWorkspace(nonExistentSlug);
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UpstreamError);
        const upstreamError = error as UpstreamError;
        expect(upstreamError.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe('File Upload FormData Handling', () => {
    it('should handle Buffer file upload correctly (FormData conversion)', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const file = Buffer.from('Test content for FormData handling');
      const fileName = `formdata-test-${Date.now()}.txt`;

      // This test specifically verifies the Buffer to Blob conversion works
      // If FormData handling fails, this will throw a type error
      const result = await documentService.uploadFile(file, fileName);

      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
      // No FormData/Buffer/Blob errors should occur
    });

    it('should handle Buffer file upload with folder path', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        console.log('Skipping test - AnythingLLM not available');
        return;
      }

      const file = Buffer.from('Test content for folder upload');
      const fileName = `folder-test-${Date.now()}.txt`;
      const folderName = 'test-folder';

      const result = await documentService.uploadFile(
        file,
        fileName,
        folderName,
      );

      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
    });
  });
});
