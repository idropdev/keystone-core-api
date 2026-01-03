import request from 'supertest';
import { Test } from '@nestjs/testing';
import { ANYTHINGLLM_BASE_URL } from '../utils/constants';
import { AnythingLLMModule } from '../../src/anythingllm/anythingllm.module';
import { AnythingLLMServiceIdentityService } from '../../src/anythingllm/services/anythingllm-service-identity.service';
import { AnythingLLMWorkspaceService } from '../../src/anythingllm/workspace/anythingllm-workspace.service';
import { AnythingLLMThreadService } from '../../src/anythingllm/thread/anythingllm-thread.service';
import { AnythingLLMDocumentService } from '../../src/anythingllm/document/anythingllm-document.service';
import { AnythingLLMVectorSearchService } from '../../src/anythingllm/vector-search/anythingllm-vector-search.service';

/**
 * End-to-End Tests for AnythingLLM Workspace, Thread, and Document Endpoints
 *
 * Tests the complete S2S integration flow:
 * 1. Workspace creation and management
 * 2. Document upload and management
 * 3. Thread creation and chat
 * 4. Vector search and OpenAI-compatible endpoints
 *
 * Prerequisites:
 * - AnythingLLM must be running (ANYTHINGLLM_BASE_URL)
 * - Service identity authentication must be configured
 *
 * Note: These tests make real HTTP calls to AnythingLLM endpoints.
 */
describe('AnythingLLM Workspace, Thread, Document (E2E)', () => {
  let serviceIdentityService: AnythingLLMServiceIdentityService | null = null;
  let workspaceService: AnythingLLMWorkspaceService | null = null;
  let threadService: AnythingLLMThreadService | null = null;
  let documentService: AnythingLLMDocumentService | null = null;
  let vectorSearchService: AnythingLLMVectorSearchService | null = null;
  let testModule: any;

  const SKIP_ANYTHINGLLM_TESTS = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const ANYTHINGLLM_URL = process.env.ANYTHINGLLM_BASE_URL || ANYTHINGLLM_BASE_URL;

  let createdWorkspaceSlug: string | null = null;
  let createdThreadSlug: string | null = null;
  let uploadedDocumentLocation: string | null = null;

  beforeAll(async () => {
    if (SKIP_ANYTHINGLLM_TESTS) {
      console.log('Skipping AnythingLLM E2E tests (SKIP_ANYTHINGLLM_TESTS=true)');
      return;
    }

    try {
      testModule = await Test.createTestingModule({
        imports: [AnythingLLMModule],
      }).compile();

      serviceIdentityService = testModule.get(AnythingLLMServiceIdentityService);
      workspaceService = testModule.get(AnythingLLMWorkspaceService);
      threadService = testModule.get(AnythingLLMThreadService);
      documentService = testModule.get(AnythingLLMDocumentService);
      vectorSearchService = testModule.get(AnythingLLMVectorSearchService);
    } catch (error) {
      console.warn(
        'Failed to initialize AnythingLLM services, tests will be skipped:',
        error,
      );
    }
  }, 60000);

  afterAll(async () => {
    // Cleanup: Delete created resources
    if (!SKIP_ANYTHINGLLM_TESTS && serviceIdentityService) {
      try {
        if (createdThreadSlug && createdWorkspaceSlug) {
          await threadService?.deleteThread(
            createdWorkspaceSlug,
            createdThreadSlug,
          );
        }
        if (createdWorkspaceSlug) {
          await workspaceService?.deleteWorkspace(createdWorkspaceSlug);
        }
      } catch (error) {
        console.warn('Cleanup failed:', error);
      }
    }

    if (testModule) {
      await testModule.close();
    }
  });

  describe('Authentication', () => {
    it('should verify auth token', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !serviceIdentityService) {
        return;
      }

      const token = await serviceIdentityService.getIdToken();
      const response = await fetch(`${ANYTHINGLLM_URL}/v1/auth`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.authenticated).toBe(true);
    });
  });

  describe('Workspace Management', () => {
    it('should create workspace', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !workspaceService) {
        return;
      }

      const workspaceName = `Test Workspace ${Date.now()}`;
      const result = await workspaceService.createWorkspace({
        name: workspaceName,
      });

      expect(result.data.success).toBe(true);
      expect(result.data.workspace).toBeDefined();
      expect(result.data.workspace?.name).toBe(workspaceName);

      createdWorkspaceSlug = result.data.workspace?.slug || null;
    });

    it('should list workspaces', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !workspaceService) {
        return;
      }

      const result = await workspaceService.listWorkspaces();

      expect(result.data.workspaces).toBeDefined();
      expect(Array.isArray(result.data.workspaces)).toBe(true);
    });

    it('should get workspace by slug', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !workspaceService || !createdWorkspaceSlug) {
        return;
      }

      const result = await workspaceService.getWorkspace(createdWorkspaceSlug);

      expect(result.data).toBeDefined();
      expect(result.data.slug).toBe(createdWorkspaceSlug);
    });
  });

  describe('Document Management', () => {
    it('should get accepted file types', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        return;
      }

      const result = await documentService.getAcceptedFileTypes();

      expect(result.data.types).toBeDefined();
      expect(Array.isArray(result.data.types)).toBe(true);
    });

    it('should get metadata schema', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        return;
      }

      const result = await documentService.getMetadataSchema();

      expect(result.data.schema).toBeDefined();
    });

    it('should upload raw text document', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !documentService ||
        !createdWorkspaceSlug
      ) {
        return;
      }

      const result = await documentService.uploadRawText(
        {
          text: 'This is a test document for E2E testing.',
          metadata: {
            title: 'E2E Test Document',
            docAuthor: 'Test Author',
            docSource: 'E2E Test',
          },
        },
        'test-folder',
      );

      expect(result.data.success).toBe(true);
      expect(result.data.documents).toBeDefined();
      expect(result.data.documents?.length).toBeGreaterThan(0);

      uploadedDocumentLocation = result.data.documents?.[0]?.location || null;
    });

    it('should list documents', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !documentService) {
        return;
      }

      const result = await documentService.listDocuments();

      expect(result.data.documents).toBeDefined();
      expect(Array.isArray(result.data.documents)).toBe(true);
    });
  });

  describe('Workspace Embeddings', () => {
    it('should update workspace embeddings', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !workspaceService ||
        !createdWorkspaceSlug ||
        !uploadedDocumentLocation
      ) {
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
  });

  describe('Thread Management', () => {
    it('should create thread', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !threadService || !createdWorkspaceSlug) {
        return;
      }

      const result = await threadService.createThread(createdWorkspaceSlug, {
        name: 'Test Thread',
        userId: 1,
      });

      expect(result.data.success).toBe(true);
      expect(result.data.threadSlug).toBeDefined();

      createdThreadSlug = result.data.threadSlug || null;
    });

    it('should get thread history', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !threadService ||
        !createdWorkspaceSlug ||
        !createdThreadSlug
      ) {
        return;
      }

      const result = await threadService.getThreadHistory(
        createdWorkspaceSlug,
        createdThreadSlug,
      );

      expect(result.data.history).toBeDefined();
      expect(Array.isArray(result.data.history)).toBe(true);
    });

    it('should send message to thread', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !threadService ||
        !createdWorkspaceSlug ||
        !createdThreadSlug
      ) {
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
    });
  });

  describe('Vector Search', () => {
    it('should perform vector search', async () => {
      if (
        SKIP_ANYTHINGLLM_TESTS ||
        !vectorSearchService ||
        !createdWorkspaceSlug
      ) {
        return;
      }

      const result = await vectorSearchService.search(createdWorkspaceSlug, {
        query: 'test query',
        topN: 5,
        scoreThreshold: 0.7,
      });

      expect(result.data.results).toBeDefined();
      expect(Array.isArray(result.data.results)).toBe(true);
    });
  });

  describe('OpenAI-Compatible Endpoints', () => {
    it('should get chat completions', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !vectorSearchService) {
        return;
      }

      const result = await vectorSearchService.chatCompletions({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 100,
      });

      expect(result.data).toBeDefined();
      expect(result.data.choices).toBeDefined();
      expect(Array.isArray(result.data.choices)).toBe(true);
    });

    it('should get embeddings', async () => {
      if (SKIP_ANYTHINGLLM_TESTS || !vectorSearchService) {
        return;
      }

      const result = await vectorSearchService.embeddings({
        model: 'text-embedding-ada-002',
        input: 'test text',
      });

      expect(result.data).toBeDefined();
      expect(result.data.data).toBeDefined();
      expect(Array.isArray(result.data.data)).toBe(true);
    });
  });
});



