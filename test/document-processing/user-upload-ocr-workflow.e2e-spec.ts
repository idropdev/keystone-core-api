import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  createTestUser,
  getAdminToken,
  createTestManager,
  getTestPdfPath,
  readPdfFile,
  waitForOcrToComplete,
  TestUser,
  TestManager,
} from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

/**
 * User Upload and OCR Trigger Workflow E2E Tests
 *
 * Tests the explicit OCR trigger workflow design:
 * 1. User uploads document (no assigned manager) → becomes temporary origin manager
 * 2. User triggers OCR → verify fields, vision_output, document_output
 * 3. Assign manager to document → user loses manager authority
 * 4. Manager triggers OCR → verify manager can process
 * 5. User cannot trigger OCR after manager assignment
 * 6. Comprehensive role-based permission tests
 *
 * Design Principles:
 * - Upload means upload only (no automatic OCR)
 * - OCR must be explicitly triggered via /ocr/trigger
 * - Users are temporary origin managers when they upload without assigned manager
 * - Only origin manager (user or manager) can trigger OCR
 */
describe('User Upload and OCR Trigger Workflow (E2E)', () => {
  let adminToken: string;
  let regularUser: TestUser;
  let manager: TestManager;
  let managerUser: TestUser;
  let documentId: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Create a regular user (without assigned manager)
    regularUser = await createTestUser(RoleEnum.user, 'upload-user');

    // Create a manager for assignment tests
    manager = await createTestManager(adminToken);
    managerUser = {
      id: manager.userId,
      email: '',
      token: manager.token,
      roleId: RoleEnum.manager,
    };
  }, 120000);

  // ============================================================================
  // Test 1: User Uploads Document (Temporary Origin Manager)
  // ============================================================================
  describe('User Upload (Temporary Origin Manager)', () => {
    it('should allow user without assigned manager to upload document', async () => {
      const pdfBuffer = readPdfFile(getTestPdfPath());

      let response = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(regularUser.token, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .field('description', 'Test document for user upload workflow')
        .attach('file', pdfBuffer, 'lab-result.pdf');

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[UPLOAD TEST] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post('/api/v1/documents/upload')
          .auth(regularUser.token, { type: 'bearer' })
          .field('documentType', 'LAB_RESULT')
          .field('description', 'Test document for user upload workflow')
          .attach('file', pdfBuffer, 'lab-result.pdf');
      }

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('documentType', 'LAB_RESULT');
      expect(response.body).toHaveProperty('status', 'UPLOADED');
      expect(response.body).toHaveProperty('fileName', 'lab-result.pdf');
      expect(response.body).toHaveProperty('fileSize');
      expect(response.body).toHaveProperty('mimeType', 'application/pdf');
      expect(response.body).toHaveProperty('description', 'Test document for user upload workflow');
      expect(response.body).toHaveProperty('createdAt');
      expect(response.body).toHaveProperty('uploadedAt');

      // User should be temporary origin manager (originManagerId is null)
      expect(response.body).toHaveProperty('originManagerId', null);
      // processedAt may exist but should be null (not set yet since no processing occurred)
      if (response.body.processedAt !== undefined) {
        expect(response.body.processedAt).toBeNull();
      }

      documentId = response.body.id;
    });

    it('should verify document status is UPLOADED (no automatic processing)', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      let response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/status`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[STATUS CHECK] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}/status`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(200);
      // Status endpoint should return: id, status, processingStartedAt, processedAt, errorMessage, progress
      expect(response.body).toHaveProperty('id', documentId);
      expect(response.body).toHaveProperty('status', 'UPLOADED');
      // For just uploaded document: processingStartedAt and processedAt should be null, progress should be 10
      if (response.body.processingStartedAt !== undefined) {
        expect(response.body.processingStartedAt).toBeNull();
      }
      if (response.body.processedAt !== undefined) {
        expect(response.body.processedAt).toBeNull();
      }
      if (response.body.errorMessage !== undefined) {
        expect(response.body.errorMessage).toBeNull();
      }
      // UPLOADED status should have progress: 10
      if (response.body.progress !== undefined) {
        expect(response.body.progress).toBe(10);
      }
    });

    it('should allow user to view their uploaded document', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      let response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[VIEW DOCUMENT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', documentId);
      expect(response.body).toHaveProperty('status', 'UPLOADED');
      expect(response.body).toHaveProperty('originManagerId', null);
    });
  });

  // ============================================================================
  // Test 2: User Triggers OCR (Temporary Origin Manager)
  // ============================================================================
  describe('User Triggers OCR (Temporary Origin Manager)', () => {
    it('should allow user (temporary origin manager) to trigger OCR', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      let response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/ocr/trigger`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[OCR TRIGGER] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${documentId}/ocr/trigger`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('message', 'OCR processing triggered successfully');
    });

    it('should verify document status transitions to PROCESSING', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      // Wait a bit for status to update
      await new Promise((resolve) => setTimeout(resolve, 1000));

      let response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/status`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[STATUS TRANSITION] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}/status`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(['PROCESSING', 'PROCESSED']).toContain(response.body.status);
    });

    it('should wait for OCR processing to complete and verify extracted fields', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      // Wait for OCR processing to complete (OCR is async and takes time)
      // Using longer timeout (120s) to accommodate OCR processing time and rate limiting
      const status = await waitForOcrToComplete(documentId, regularUser.token, 120);
      expect(status).toBe('PROCESSED');

      // Get extracted fields and OCR outputs
      let fieldsResponse = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/fields`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (fieldsResponse.status === 429) {
        console.log('[GET FIELDS] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        fieldsResponse = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}/fields`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(fieldsResponse.status).toBe(200);
      
      // Verify top-level response structure exists
      // Individual field properties are optional and depend on OCR quality (not what we're testing)
      expect(fieldsResponse.body).toHaveProperty('fields');
      expect(Array.isArray(fieldsResponse.body.fields)).toBe(true);
      expect(fieldsResponse.body).toHaveProperty('document_output');
      expect(fieldsResponse.body).toHaveProperty('vision_output');
    }, 180000); // 180 second (3 minute) timeout for OCR processing and rate limit handling
  });

  // ============================================================================
  // Test 3: Assign Manager to Document
  // ============================================================================
  describe('Assign Manager to Document', () => {
    it('should allow user (temporary origin manager) to assign manager to document', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      let response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/assign-manager`)
        .auth(regularUser.token, { type: 'bearer' })
        .send({ managerId: manager.id });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[ASSIGN MANAGER] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${documentId}/assign-manager`)
          .auth(regularUser.token, { type: 'bearer' })
          .send({ managerId: manager.id });
      }

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', documentId);
      expect(response.body).toHaveProperty('originManagerId', manager.id);
      expect(response.body).not.toHaveProperty('originManagerId', null);
    });

    it('should verify user can no longer trigger OCR after manager assignment', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      // User should be rejected when trying to trigger OCR
      let response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/ocr/trigger`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[USER OCR REJECT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${documentId}/ocr/trigger`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('origin manager');
    });

    it('should verify manager can trigger OCR after assignment', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      // First, check if document is in a processable state
      let statusResponse = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/status`)
        .auth(managerUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (statusResponse.status === 429) {
        console.log('[MANAGER STATUS CHECK] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        statusResponse = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}/status`)
          .auth(managerUser.token, { type: 'bearer' });
      }

      const currentStatus = statusResponse.body.status;

      // If already processed, we can test re-processing
      if (currentStatus === 'PROCESSED') {
        let response = await request(APP_URL)
          .post(`/api/v1/documents/${documentId}/ocr/trigger`)
          .auth(managerUser.token, { type: 'bearer' });

        // Handle rate limiting (429) - retry after waiting
        if (response.status === 429) {
          console.log('[MANAGER OCR TRIGGER] Rate limited, waiting 65s before retry...');
          await new Promise((resolve) => setTimeout(resolve, 65000));
          response = await request(APP_URL)
            .post(`/api/v1/documents/${documentId}/ocr/trigger`)
            .auth(managerUser.token, { type: 'bearer' });
        }

        expect(response.status).toBe(202);
        expect(response.body).toHaveProperty('message', 'OCR processing triggered successfully');
      }
    });
  });

  // ============================================================================
  // Test 4: Role-Based Permission Tests
  // ============================================================================
  describe('Role-Based Permission Tests', () => {
    let testDocumentId: string;
    let otherUser: TestUser;
    let otherManager: TestManager;
    let otherManagerUser: TestUser;

    beforeAll(async () => {
      // Create another user for permission testing
      otherUser = await createTestUser(RoleEnum.user, 'other-user');

      // Create another manager for permission testing
      otherManager = await createTestManager(adminToken);
      otherManagerUser = {
        id: otherManager.userId,
        email: '',
        token: otherManager.token,
        roleId: RoleEnum.manager,
      };

      // Wait to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Create a test document uploaded by regularUser (temporary origin manager)
      const pdfBuffer = readPdfFile(getTestPdfPath());
      let uploadResponse = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(regularUser.token, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .attach('file', pdfBuffer, 'permission-test.pdf');

      // Handle rate limiting (429) - retry after waiting
      if (uploadResponse.status === 429) {
        console.log('[BEFOREALL UPLOAD] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        uploadResponse = await request(APP_URL)
          .post('/api/v1/documents/upload')
          .auth(regularUser.token, { type: 'bearer' })
          .field('documentType', 'LAB_RESULT')
          .attach('file', pdfBuffer, 'permission-test.pdf');
      }

      expect(uploadResponse.status).toBe(201);
      testDocumentId = uploadResponse.body.id;
    }, 120000);

    it('should reject other user from triggering OCR on document they did not upload', async () => {
      if (!testDocumentId) {
        throw new Error('testDocumentId not set from beforeAll');
      }

      let response = await request(APP_URL)
        .post(`/api/v1/documents/${testDocumentId}/ocr/trigger`)
        .auth(otherUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[OTHER USER OCR REJECT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${testDocumentId}/ocr/trigger`)
          .auth(otherUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('origin manager');
    });

    it('should reject other manager from triggering OCR on document they do not own', async () => {
      if (!testDocumentId) {
        throw new Error('testDocumentId not set from beforeAll');
      }

      let response = await request(APP_URL)
        .post(`/api/v1/documents/${testDocumentId}/ocr/trigger`)
        .auth(otherManagerUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[OTHER MANAGER OCR REJECT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${testDocumentId}/ocr/trigger`)
          .auth(otherManagerUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('origin manager');
    });

    it('should reject admin from triggering OCR', async () => {
      if (!testDocumentId) {
        throw new Error('testDocumentId not set from beforeAll');
      }

      let response = await request(APP_URL)
        .post(`/api/v1/documents/${testDocumentId}/ocr/trigger`)
        .auth(adminToken, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[ADMIN OCR REJECT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${testDocumentId}/ocr/trigger`)
          .auth(adminToken, { type: 'bearer' });
      }

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('document-level access');
    });

    it('should allow user (temporary origin manager) to trigger OCR on their own document', async () => {
      if (!testDocumentId) {
        throw new Error('testDocumentId not set from beforeAll');
      }

      // Wait to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));

      let response = await request(APP_URL)
        .post(`/api/v1/documents/${testDocumentId}/ocr/trigger`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[OCR TRIGGER] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${testDocumentId}/ocr/trigger`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(202);
      expect(response.body).toHaveProperty('message', 'OCR processing triggered successfully');
    }, 180000); // Extended timeout for rate limit handling (up to 65s wait + retry)

    it('should allow user (temporary origin manager) to view their own document', async () => {
      if (!testDocumentId) {
        throw new Error('testDocumentId not set from beforeAll');
      }

      let response = await request(APP_URL)
        .get(`/api/v1/documents/${testDocumentId}`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[VIEW OWN DOCUMENT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .get(`/api/v1/documents/${testDocumentId}`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', testDocumentId);
    });

    it('should reject other user from viewing document without access grant', async () => {
      if (!testDocumentId) {
        throw new Error('testDocumentId not set from beforeAll');
      }

      let response = await request(APP_URL)
        .get(`/api/v1/documents/${testDocumentId}`)
        .auth(otherUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[OTHER USER VIEW REJECT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .get(`/api/v1/documents/${testDocumentId}`)
          .auth(otherUser.token, { type: 'bearer' });
      }

      // Security: Returns 404 (not 403) to avoid leaking document existence
      // When access is denied, we return NotFoundException instead of ForbiddenException
      expect(response.status).toBe(404);
    });

    it('should reject other manager from viewing document without access grant', async () => {
      if (!testDocumentId) {
        throw new Error('testDocumentId not set from beforeAll');
      }

      let response = await request(APP_URL)
        .get(`/api/v1/documents/${testDocumentId}`)
        .auth(otherManagerUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[OTHER MANAGER VIEW REJECT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .get(`/api/v1/documents/${testDocumentId}`)
          .auth(otherManagerUser.token, { type: 'bearer' });
      }

      // Security: Returns 404 (not 403) to avoid leaking document existence
      // When access is denied, we return NotFoundException instead of ForbiddenException
      expect(response.status).toBe(404);
    });

    it('should allow user (temporary origin manager) to assign manager to their own document', async () => {
      if (!testDocumentId) {
        throw new Error('testDocumentId not set from beforeAll');
      }

      let response = await request(APP_URL)
        .post(`/api/v1/documents/${testDocumentId}/assign-manager`)
        .auth(regularUser.token, { type: 'bearer' })
        .send({ managerId: manager.id });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[ASSIGN MANAGER TEST] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${testDocumentId}/assign-manager`)
          .auth(regularUser.token, { type: 'bearer' })
          .send({ managerId: manager.id });
      }

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('originManagerId', manager.id);
    });

    it('should reject other user from assigning manager to document they did not upload', async () => {
      // Create a new document for this test
      const pdfBuffer = readPdfFile(getTestPdfPath());
      let uploadResponse = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(regularUser.token, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .attach('file', pdfBuffer, 'assign-test.pdf');

      // Handle rate limiting (429) - retry after waiting
      if (uploadResponse.status === 429) {
        console.log('[ASSIGN REJECT UPLOAD] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        uploadResponse = await request(APP_URL)
          .post('/api/v1/documents/upload')
          .auth(regularUser.token, { type: 'bearer' })
          .field('documentType', 'LAB_RESULT')
          .attach('file', pdfBuffer, 'assign-test.pdf');
      }

      const newDocumentId = uploadResponse.body.id;

      let response = await request(APP_URL)
        .post(`/api/v1/documents/${newDocumentId}/assign-manager`)
        .auth(otherUser.token, { type: 'bearer' })
        .send({ managerId: manager.id });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[ASSIGN REJECT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .post(`/api/v1/documents/${newDocumentId}/assign-manager`)
          .auth(otherUser.token, { type: 'bearer' })
          .send({ managerId: manager.id });
      }

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('uploaded');
    });
  });

  // ============================================================================
  // Test 5: Full Workflow - User Upload → OCR → Assign Manager → Manager OCR
  // ============================================================================
  describe('Full Workflow: User Upload → OCR → Assign Manager → Manager OCR', () => {
    let workflowDocumentId: string;

    it('should complete full workflow: user uploads, triggers OCR, assigns manager, manager triggers OCR', async () => {
      // Step 1: User uploads document
      const pdfBuffer = readPdfFile(getTestPdfPath());
      let uploadResponse = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(regularUser.token, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .field('description', 'Full workflow test document')
        .attach('file', pdfBuffer, 'workflow-test.pdf');

      // Handle rate limiting (429) - retry after waiting
      if (uploadResponse.status === 429) {
        console.log('[FULL WORKFLOW UPLOAD] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        uploadResponse = await request(APP_URL)
          .post('/api/v1/documents/upload')
          .auth(regularUser.token, { type: 'bearer' })
          .field('documentType', 'LAB_RESULT')
          .field('description', 'Full workflow test document')
          .attach('file', pdfBuffer, 'workflow-test.pdf');
      }

      expect(uploadResponse.status).toBe(201);
      workflowDocumentId = uploadResponse.body.id;
      expect(uploadResponse.body).toHaveProperty('status', 'UPLOADED');
      expect(uploadResponse.body).toHaveProperty('originManagerId', null);

      // Step 2: User triggers OCR
      // Wait to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));

      let triggerResponse = await request(APP_URL)
        .post(`/api/v1/documents/${workflowDocumentId}/ocr/trigger`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (triggerResponse.status === 429) {
        console.log('[FULL WORKFLOW] Rate limited on OCR trigger, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        triggerResponse = await request(APP_URL)
          .post(`/api/v1/documents/${workflowDocumentId}/ocr/trigger`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(triggerResponse.status).toBe(202);

      // Step 3: Wait for OCR to complete (OCR is async and takes time)
      // Using longer timeout (120s) to accommodate OCR processing time and rate limiting
      const status = await waitForOcrToComplete(workflowDocumentId, regularUser.token, 120);
      expect(status).toBe('PROCESSED');

      // Step 4: Verify extracted fields are available
      // Only verify top-level structure - individual field properties are optional and depend on OCR quality
      let fieldsResponse = await request(APP_URL)
        .get(`/api/v1/documents/${workflowDocumentId}/fields`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (fieldsResponse.status === 429) {
        console.log('[FULL WORKFLOW GET FIELDS] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        fieldsResponse = await request(APP_URL)
          .get(`/api/v1/documents/${workflowDocumentId}/fields`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(fieldsResponse.status).toBe(200);
      expect(fieldsResponse.body).toHaveProperty('fields');
      expect(Array.isArray(fieldsResponse.body.fields)).toBe(true);
      expect(fieldsResponse.body).toHaveProperty('document_output');
      expect(fieldsResponse.body).toHaveProperty('vision_output');

      // Step 5: User assigns manager
      let assignResponse = await request(APP_URL)
        .post(`/api/v1/documents/${workflowDocumentId}/assign-manager`)
        .auth(regularUser.token, { type: 'bearer' })
        .send({ managerId: manager.id });

      // Handle rate limiting (429) - retry after waiting
      if (assignResponse.status === 429) {
        console.log('[FULL WORKFLOW ASSIGN] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        assignResponse = await request(APP_URL)
          .post(`/api/v1/documents/${workflowDocumentId}/assign-manager`)
          .auth(regularUser.token, { type: 'bearer' })
          .send({ managerId: manager.id });
      }

      expect(assignResponse.status).toBe(200);
      expect(assignResponse.body).toHaveProperty('originManagerId', manager.id);

      // Step 6: User can no longer trigger OCR
      let userTriggerResponse = await request(APP_URL)
        .post(`/api/v1/documents/${workflowDocumentId}/ocr/trigger`)
        .auth(regularUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (userTriggerResponse.status === 429) {
        console.log('[FULL WORKFLOW USER OCR REJECT] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        userTriggerResponse = await request(APP_URL)
          .post(`/api/v1/documents/${workflowDocumentId}/ocr/trigger`)
          .auth(regularUser.token, { type: 'bearer' });
      }

      expect(userTriggerResponse.status).toBe(403);

      // Step 7: Manager can trigger OCR (re-processing)
      let managerTriggerResponse = await request(APP_URL)
        .post(`/api/v1/documents/${workflowDocumentId}/ocr/trigger`)
        .auth(managerUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (managerTriggerResponse.status === 429) {
        console.log('[FULL WORKFLOW MANAGER OCR] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        managerTriggerResponse = await request(APP_URL)
          .post(`/api/v1/documents/${workflowDocumentId}/ocr/trigger`)
          .auth(managerUser.token, { type: 'bearer' });
      }

      expect(managerTriggerResponse.status).toBe(202);

      // Step 8: Verify manager can view document
      let managerViewResponse = await request(APP_URL)
        .get(`/api/v1/documents/${workflowDocumentId}`)
        .auth(managerUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (managerViewResponse.status === 429) {
        console.log('[FULL WORKFLOW MANAGER VIEW] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        managerViewResponse = await request(APP_URL)
          .get(`/api/v1/documents/${workflowDocumentId}`)
          .auth(managerUser.token, { type: 'bearer' });
      }

      expect(managerViewResponse.status).toBe(200);
      expect(managerViewResponse.body).toHaveProperty('id', workflowDocumentId);
      expect(managerViewResponse.body).toHaveProperty('originManagerId', manager.id);
    }, 300000); // 5 minute timeout for full workflow (includes OCR processing and rate limit handling)
  });
});

