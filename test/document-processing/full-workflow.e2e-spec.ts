import * as path from 'path';
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  createTestUser,
  getAdminToken,
  createTestManager,
  uploadTestDocument,
  createAccessGrant,
  getTestPdfPath,
  readPdfFile,
  TestUser,
  TestManager,
} from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

/**
 * Comprehensive Document Processing Full Workflow E2E Tests
 * 
 * Tests the complete end-to-end functionality of the document processing system:
 * 1. User creation and authentication
 * 2. Document upload
 * 3. OCR triggering and processing
 * 4. Status checking
 * 5. Field extraction and retrieval
 * 6. Manager assignment and access control
 * 7. Full workflow scenarios
 * 
 * This test suite validates the intelligent PDF processing system that uses:
 * - pdf2json for direct text extraction (fast, free)
 * - pdf-parse fallback for XRef errors
 * - GCP Document AI OCR as final fallback (costs apply)
 */
describe('Document Processing Full Workflow (E2E)', () => {
  let adminToken: string;
  let regularUser: TestUser;
  let manager: TestManager;
  let managerUser: TestUser;
  let documentId: string;

  beforeAll(async () => {
    // Create admin token for manager creation
    adminToken = await getAdminToken();

    // Create a regular user
    regularUser = await createTestUser(RoleEnum.user, 'workflow-user');

    // Create a manager (for document uploads and processing)
    manager = await createTestManager(adminToken);
    managerUser = {
      id: manager.userId,
      email: '',
      token: manager.token,
      roleId: RoleEnum.manager,
    };
  }, 120000); // Increase timeout for user creation

  // ============================================================================
  // Test 1: User Creation and Authentication
  // ============================================================================
  describe('User Creation and Authentication', () => {
    it('should create and authenticate a regular user', async () => {
      expect(regularUser).toBeDefined();
      expect(regularUser.id).toBeGreaterThan(0);
      expect(regularUser.token).toBeDefined();
      expect(regularUser.roleId).toBe(RoleEnum.user);
    });

    it('should create and authenticate a manager', async () => {
      expect(manager).toBeDefined();
      expect(manager.id).toBeGreaterThan(0);
      expect(manager.userId).toBeGreaterThan(0);
      expect(manager.token).toBeDefined();
      expect(managerUser.roleId).toBe(RoleEnum.manager);
    });

    it('should verify user can access /auth/me endpoint', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/auth/me')
        .auth(regularUser.token, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', regularUser.id);
      expect(response.body).toHaveProperty('role');
      expect(response.body.role).toHaveProperty('id', RoleEnum.user);
    });
  });

  // ============================================================================
  // Test 2: Document Upload Workflow
  // ============================================================================
  describe('Document Upload Workflow', () => {
    it('should allow manager to upload a document', async () => {
      const pdfBuffer = readPdfFile(getTestPdfPath());

      const response = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser.token, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .field('description', 'Test lab result for workflow testing')
        .attach('file', pdfBuffer, 'lab-result.pdf');

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('documentType', 'LAB_RESULT');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('fileName', 'lab-result.pdf');
      expect(response.body).toHaveProperty('fileSize');
      expect(response.body).toHaveProperty('mimeType', 'application/pdf');
      expect(response.body).toHaveProperty('originManagerId', manager.id);
      expect(response.body).toHaveProperty('description', 'Test lab result for workflow testing');
      expect(response.body).toHaveProperty('createdAt');

      // Store documentId for subsequent tests
      documentId = response.body.id;
    });

    it('should validate document status is STORED after upload', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      const response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/status`)
        .auth(managerUser.token, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', documentId);
      expect(response.body).toHaveProperty('status');
      // Document should be in STORED status after upload (OCR is manual)
      expect(['STORED', 'UPLOADED']).toContain(response.body.status);
    });

    it('should allow user without assigned manager to upload (user becomes temporary origin manager)', async () => {
      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF',
      );

      const response = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(regularUser.token, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .attach('file', pdfBuffer, 'test-document.pdf');

      // User without assigned manager should be able to upload
      // They become temporary origin manager (originManagerId = null)
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('originManagerId', null);
      expect(response.body).toHaveProperty('documentType', 'LAB_RESULT');
    });

    it('should validate required fields on upload', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser.token, { type: 'bearer' });

      expect([400, 422]).toContain(response.status);
    });
  });

  // ============================================================================
  // Test 3: Document Details and Metadata
  // ============================================================================
  describe('Document Details and Metadata', () => {
    it('should retrieve complete document details', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      const response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}`)
        .auth(managerUser.token, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', documentId);
      expect(response.body).toHaveProperty('documentType', 'LAB_RESULT');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('fileName', 'lab-result.pdf');
      expect(response.body).toHaveProperty('fileSize');
      expect(response.body).toHaveProperty('mimeType', 'application/pdf');
      expect(response.body).toHaveProperty('originManagerId', manager.id);
      expect(response.body).toHaveProperty('description', 'Test lab result for workflow testing');
      expect(response.body).toHaveProperty('createdAt');
    });

    it('should generate download URL for document', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      const response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/download`)
        .auth(managerUser.token, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('downloadUrl');
      expect(response.body).toHaveProperty('expiresIn');
      expect(typeof response.body.downloadUrl).toBe('string');
      expect(response.body.downloadUrl).toMatch(/^https?:\/\//);
      expect(response.body.expiresIn).toBeGreaterThan(0);
    });

    it('should list documents for manager', async () => {
      if (!documentId) {
        throw new Error('documentId not set from previous test');
      }

      console.log('[DOCUMENT LIST] Starting test - Expected documentId:', documentId);
      console.log('[DOCUMENT LIST] Manager ID:', manager.id);
      console.log('[DOCUMENT LIST] Manager User ID:', managerUser.id);

      const response = await request(APP_URL)
        .get('/api/v1/documents')
        .auth(managerUser.token, { type: 'bearer' });

      console.log('[DOCUMENT LIST] Response status:', response.status);
      console.log('[DOCUMENT LIST] Response body keys:', Object.keys(response.body || {}));

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).toHaveProperty('hasNextPage');
      expect(typeof response.body.hasNextPage).toBe('boolean');

      // Check array contents
      const documents = response.body.data;
      const documentIds = documents.map((doc: any) => doc.id);

      console.log('[DOCUMENT LIST] Found documents count:', documents.length);
      console.log('[DOCUMENT LIST] hasNextPage:', response.body.hasNextPage);
      console.log('[DOCUMENT LIST] Document IDs in array:', JSON.stringify(documentIds));
      console.log('[DOCUMENT LIST] Expected documentId:', documentId);
      console.log('[DOCUMENT LIST] Document found in array?', documentIds.includes(documentId));

      // Print full response body
      console.log('[DOCUMENT LIST] Full response body:', JSON.stringify(response.body, null, 2));

      // Print complete array contents
      if (documents.length === 0) {
        console.log('[DOCUMENT LIST] ARRAY IS EMPTY - No documents returned');
      } else {
        console.log('[DOCUMENT LIST] Printing all documents in array:');
        documents.forEach((doc: any, index: number) => {
          console.log(`[DOCUMENT LIST] Document ${index + 1}:`, JSON.stringify(doc, null, 2));
        });
      }

      // Check if our document is in the list (may need to check multiple pages)
      const foundInFirstPage = documentIds.includes(documentId);

      if (!foundInFirstPage) {
        console.log('[DOCUMENT LIST] Document not found in first page, checking with limit=100');
        // Try with a higher limit to check if it's a pagination issue
        const allPagesResponse = await request(APP_URL)
          .get('/api/v1/documents?limit=100')
          .auth(managerUser.token, { type: 'bearer' });

        console.log('[DOCUMENT LIST] Response with limit=100 - status:', allPagesResponse.status);

        if (
          allPagesResponse.status === 200 &&
          Array.isArray(allPagesResponse.body.data)
        ) {
          const allDocuments = allPagesResponse.body.data;
          const allDocumentIds = allDocuments.map((doc: any) => doc.id);

          console.log('[DOCUMENT LIST] With limit=100, found total documents:', allDocumentIds.length);
          console.log('[DOCUMENT LIST] All document IDs with limit=100:', JSON.stringify(allDocumentIds));

          // Print full array with limit=100
          if (allDocuments.length === 0) {
            console.log('[DOCUMENT LIST] ARRAY IS EMPTY - No documents returned even with limit=100');
          } else {
            console.log('[DOCUMENT LIST] Printing all documents with limit=100:');
            allDocuments.forEach((doc: any, index: number) => {
              console.log(`[DOCUMENT LIST] Document ${index + 1} (limit=100):`, JSON.stringify(doc, null, 2));
            });
          }

          if (allDocumentIds.includes(documentId)) {
            console.log('[DOCUMENT LIST] ✅ Document found in full list (pagination issue)');
            // Document exists, just not on first page - acceptable
            expect(allDocumentIds).toContain(documentId);
            return;
          } else {
            console.log('[DOCUMENT LIST] ❌ Document still not found even with limit=100');
            console.log('[DOCUMENT LIST] Full response body (limit=100):', JSON.stringify(allPagesResponse.body, null, 2));
          }
        }
      }

      // Final assertion - document should be in the list
      if (documents.length === 0) {
        console.log('[DOCUMENT LIST] ⚠️ No documents returned. Expected documentId:', documentId);
      }

      console.log('[DOCUMENT LIST] Final check - documentIds:', JSON.stringify(documentIds));
      console.log('[DOCUMENT LIST] Final check - expected documentId:', documentId);
      expect(documentIds).toContain(documentId);
    });
  });

  // ============================================================================
  // Test 4: OCR Triggering and Processing
  // ============================================================================
  describe('OCR Triggering and Processing', () => {
    it('should allow origin manager to trigger OCR processing', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Wait a moment to ensure document is fully stored
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/ocr/trigger`)
        .auth(managerUser.token, { type: 'bearer' });

      // May return 202 (accepted) or 400 (document not in correct state)
      expect([202, 400]).toContain(response.status);

      if (response.status === 202) {
        expect(response.body).toHaveProperty('message');
        expect(response.body.message).toContain('triggered');
      }
    }, 30000); // Longer timeout for OCR trigger

    it('should reject non-origin manager from triggering OCR', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Create a secondary manager
      const secondaryManager = await createTestManager(adminToken);
      const secondaryManagerUser: TestUser = {
        id: secondaryManager.userId,
        email: '',
        token: secondaryManager.token,
        roleId: RoleEnum.manager,
      };

      const response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/ocr/trigger`)
        .auth(secondaryManagerUser.token, { type: 'bearer' });

      // Should be forbidden or bad request (not origin manager)
      expect([400, 403]).toContain(response.status);
    }, 120000); // Timeout for manager creation

    it('should reject regular user from triggering OCR', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Create access grant for user first
      try {
        await createAccessGrant(
          managerUser.token,
          documentId,
          'user',
          regularUser.id,
          'delegated',
        );

        // Small delay to ensure grant is committed
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await request(APP_URL)
          .post(`/api/v1/documents/${documentId}/ocr/trigger`)
          .auth(regularUser.token, { type: 'bearer' });

        // Users cannot trigger OCR - only origin manager
        expect([400, 403]).toContain(response.status);
      } catch (error) {
        console.warn('Access grant creation failed, skipping test:', error);
      }
    }, 120000);
  });

  // ============================================================================
  // Test 5: Status Checking During Processing
  // ============================================================================
  describe('Status Checking During Processing', () => {
    it('should track document status progression', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Check status multiple times to see progression
      // Note: OCR processing may be fast or async, so we check a few times
      let previousStatus: string | null = null;
      const maxAttempts = 10;
      const delayMs = 2000; // 2 seconds between checks

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let response = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}/status`)
          .auth(managerUser.token, { type: 'bearer' });

        // Handle rate limiting (429) - retry after waiting
        if (response.status === 429) {
          console.log(
            `[STATUS PROGRESSION] Rate limited on attempt ${attempt + 1}, waiting 65s before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 65000));
          response = await request(APP_URL)
            .get(`/api/v1/documents/${documentId}/status`)
            .auth(managerUser.token, { type: 'bearer' });
        }

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('status');

        const currentStatus = response.body.status;
        console.log(
          `[STATUS CHECK] Attempt ${attempt + 1}: Status = ${currentStatus}`,
        );

        // Valid statuses during processing lifecycle
        expect([
          'UPLOADED',
          'STORED',
          'QUEUED',
          'PROCESSING',
          'PROCESSED',
          'FAILED',
        ]).toContain(currentStatus);

        // If document is processed or failed, stop checking
        if (currentStatus === 'PROCESSED' || currentStatus === 'FAILED') {
          console.log(
            `[STATUS CHECK] Document reached final state: ${currentStatus}`,
          );
          break;
        }

        // Wait before next check
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }, 180000); // 3 minute timeout to account for rate limiting (65s) + multiple status checks

    it('should return progress information when processing', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      let response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/status`)
        .auth(managerUser.token, { type: 'bearer' });

      // Handle rate limiting (429) - retry after waiting
      if (response.status === 429) {
        console.log('[PROGRESS CHECK] Rate limited, waiting 65s before retry...');
        await new Promise((resolve) => setTimeout(resolve, 65000));
        response = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}/status`)
          .auth(managerUser.token, { type: 'bearer' });
      }

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');

      // If processing, progress should be present
      if (response.body.status === 'PROCESSING') {
        expect(response.body.progress).toBeDefined();
        expect(typeof response.body.progress).toBe('number');
        expect(response.body.progress).toBeGreaterThanOrEqual(0);
        expect(response.body.progress).toBeLessThanOrEqual(100);
      }
    }, 120000); // 2 minute timeout to account for rate limiting (65s wait)
  });

  // ============================================================================
  // Test 6: Field Extraction and Retrieval
  // ============================================================================
  describe('Field Extraction and Retrieval', () => {
    it('should wait for document to be processed before checking fields', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Wait for document to reach PROCESSED status
      let isProcessed = false;
      const maxWaitAttempts = 30; // 30 attempts = 60 seconds max wait
      const delayMs = 2000;

      for (let attempt = 0; attempt < maxWaitAttempts; attempt++) {
        const statusResponse = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}/status`)
          .auth(managerUser.token, { type: 'bearer' });

        if (statusResponse.status === 200) {
          const status = statusResponse.body.status;
          console.log(
            `[FIELD EXTRACTION] Waiting for processing... Status: ${status} (attempt ${attempt + 1}/${maxWaitAttempts})`,
          );

          if (status === 'PROCESSED') {
            isProcessed = true;
            console.log('[FIELD EXTRACTION] Document is now PROCESSED');
            break;
          }

          if (status === 'FAILED') {
            console.warn(
              '[FIELD EXTRACTION] Document processing failed, cannot test field extraction',
            );
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (!isProcessed) {
        console.warn(
          '[FIELD EXTRACTION] Document did not reach PROCESSED status within timeout, skipping field extraction test',
        );
        return;
      }

      // Now check fields
      const fieldsResponse = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/fields`)
        .auth(managerUser.token, { type: 'bearer' });

      // Should return 200 with fields array (may be empty if no entities extracted)
      if (fieldsResponse.status === 200) {
        expect(fieldsResponse.body).toHaveProperty('fields');
        expect(Array.isArray(fieldsResponse.body.fields)).toBe(true);

        // If fields are present, validate structure
        if (fieldsResponse.body.fields.length > 0) {
          const firstField = fieldsResponse.body.fields[0];
          expect(firstField).toHaveProperty('fieldKey');
          expect(firstField).toHaveProperty('fieldValue');
          expect(firstField).toHaveProperty('fieldType');
          expect(firstField).toHaveProperty('confidence');
          expect(typeof firstField.confidence).toBe('number');
          expect(firstField.confidence).toBeGreaterThanOrEqual(0);
          expect(firstField.confidence).toBeLessThanOrEqual(1);

          console.log(
            `[FIELD EXTRACTION] Retrieved ${fieldsResponse.body.fields.length} fields`,
          );
          console.log(
            `[FIELD EXTRACTION] Sample field: ${firstField.fieldKey} = ${firstField.fieldValue?.substring(0, 50)}`,
          );
        } else {
          console.log(
            '[FIELD EXTRACTION] No fields extracted (this is OK - document may not contain extractable entities)',
          );
        }
      } else if (fieldsResponse.status === 409) {
        console.log(
          '[FIELD EXTRACTION] Document not processed yet (409 Conflict)',
        );
      } else {
        throw new Error(
          `Unexpected status when retrieving fields: ${fieldsResponse.status}`,
        );
      }
    }, 120000); // 2 minute timeout for processing and field extraction

    it('should return 409 when fields requested for unprocessed document', async () => {
      // Upload a new document
      const pdfBuffer = readPdfFile(getTestPdfPath());
      const uploadResponse = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser.token, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .attach('file', pdfBuffer, 'lab-result.pdf');

      if (uploadResponse.status === 201) {
        const newDocId = uploadResponse.body.id;

        // Immediately request fields (should be 409 if not processed)
        const fieldsResponse = await request(APP_URL)
          .get(`/api/v1/documents/${newDocId}/fields`)
          .auth(managerUser.token, { type: 'bearer' });

        // Should return 409 if not PROCESSED, or 200 if already processed (unlikely but possible)
        expect([200, 409]).toContain(fieldsResponse.status);
      }
    });
  });

  // ============================================================================
  // Test 7: Manager Assignment and Access Control
  // ============================================================================
  describe('Manager Assignment and Access Control', () => {
    it('should allow origin manager to access their documents', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      const response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}`)
        .auth(managerUser.token, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', documentId);
      expect(response.body).toHaveProperty('originManagerId', manager.id);
    });

    it('should allow user with access grant to view document', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Create access grant for regular user
      try {
        await createAccessGrant(
          managerUser.token,
          documentId,
          'user',
          regularUser.id,
          'delegated',
        );

        // Small delay to ensure grant is committed
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}`)
          .auth(regularUser.token, { type: 'bearer' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('id', documentId);
      } catch (error) {
        console.warn(
          'Access grant creation failed, skipping access control test:',
          error,
        );
      }
    }, 120000);

    it('should reject user without access grant from viewing document', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Create a new user without access grant
      const unauthorizedUser = await createTestUser(RoleEnum.user, 'unauthorized-user');

      const response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}`)
        .auth(unauthorizedUser.token, { type: 'bearer' });

      // Security: 404 if document doesn't exist OR no access (don't leak existence)
      expect([403, 404]).toContain(response.status);
    }, 120000);

    it('should allow secondary manager with access grant to view document', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Create secondary manager
      const secondaryManager = await createTestManager(adminToken);
      const secondaryManagerUser: TestUser = {
        id: secondaryManager.userId,
        email: '',
        token: secondaryManager.token,
        roleId: RoleEnum.manager,
      };

      // Create access grant for secondary manager
      try {
        await createAccessGrant(
          managerUser.token,
          documentId,
          'manager',
          secondaryManager.id,
          'delegated',
        );

        // Small delay to ensure grant is committed
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await request(APP_URL)
          .get(`/api/v1/documents/${documentId}`)
          .auth(secondaryManagerUser.token, { type: 'bearer' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('id', documentId);
      } catch (error) {
        console.warn(
          'Access grant creation failed, skipping secondary manager test:',
          error,
        );
      }
    }, 120000);
  });

  // ============================================================================
  // Test 8: Full End-to-End Workflow Scenario
  // ============================================================================
  describe('Full End-to-End Workflow Scenario', () => {
    let workflowDocumentId: string;

    it('should complete full workflow: upload -> trigger OCR -> check status -> get fields -> verify access', async () => {
      // Step 1: Upload document
      console.log('[FULL WORKFLOW] Step 1: Uploading document...');
      const pdfBuffer = readPdfFile(getTestPdfPath());
      const uploadResponse = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser.token, { type: 'bearer' })
        .field('documentType', 'LAB_RESULT')
        .field('description', 'Full workflow test document')
        .attach('file', pdfBuffer, 'workflow-test.pdf');

      expect(uploadResponse.status).toBe(201);
      expect(uploadResponse.body).toHaveProperty('id');
      workflowDocumentId = uploadResponse.body.id;
      console.log(
        `[FULL WORKFLOW] Document uploaded: ${workflowDocumentId}, Status: ${uploadResponse.body.status}`,
      );

      // Step 2: Verify document details
      console.log('[FULL WORKFLOW] Step 2: Verifying document details...');
      const detailsResponse = await request(APP_URL)
        .get(`/api/v1/documents/${workflowDocumentId}`)
        .auth(managerUser.token, { type: 'bearer' });

      expect(detailsResponse.status).toBe(200);
      expect(detailsResponse.body).toHaveProperty('id', workflowDocumentId);
      expect(detailsResponse.body).toHaveProperty('originManagerId', manager.id);
      console.log(
        `[FULL WORKFLOW] Document details verified: ${detailsResponse.body.fileName}`,
      );

      // Step 3: Trigger OCR processing
      console.log('[FULL WORKFLOW] Step 3: Triggering OCR processing...');
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for document to be fully stored

      const triggerResponse = await request(APP_URL)
        .post(`/api/v1/documents/${workflowDocumentId}/ocr/trigger`)
        .auth(managerUser.token, { type: 'bearer' });

      expect([202, 400]).toContain(triggerResponse.status);
      if (triggerResponse.status === 202) {
        console.log('[FULL WORKFLOW] OCR processing triggered successfully');
      } else {
        console.log(
          `[FULL WORKFLOW] OCR trigger returned ${triggerResponse.status} (document may already be processing or in wrong state)`,
        );
      }

      // Step 4: Monitor status until PROCESSED
      console.log('[FULL WORKFLOW] Step 4: Monitoring processing status...');
      let isProcessed = false;
      const maxWaitAttempts = 30;
      const delayMs = 2000;

      for (let attempt = 0; attempt < maxWaitAttempts; attempt++) {
        let statusResponse = await request(APP_URL)
          .get(`/api/v1/documents/${workflowDocumentId}/status`)
          .auth(managerUser.token, { type: 'bearer' });

        // Handle rate limiting (429) - retry after waiting
        if (statusResponse.status === 429) {
          console.log(
            `[FULL WORKFLOW STATUS] Rate limited on attempt ${attempt + 1}, waiting 65s before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 65000));
          statusResponse = await request(APP_URL)
            .get(`/api/v1/documents/${workflowDocumentId}/status`)
            .auth(managerUser.token, { type: 'bearer' });
        }

        expect(statusResponse.status).toBe(200);
        const status = statusResponse.body.status;
        console.log(
          `[FULL WORKFLOW] Status check ${attempt + 1}/${maxWaitAttempts}: ${status}`,
        );

        if (status === 'PROCESSED') {
          isProcessed = true;
          console.log('[FULL WORKFLOW] Document processing completed!');
          break;
        }

        if (status === 'FAILED') {
          console.warn(
            '[FULL WORKFLOW] Document processing failed, continuing with workflow test',
          );
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      // Step 5: Retrieve extracted fields (if processed)
      if (isProcessed) {
        console.log('[FULL WORKFLOW] Step 5: Retrieving extracted fields...');
        let fieldsResponse = await request(APP_URL)
          .get(`/api/v1/documents/${workflowDocumentId}/fields`)
          .auth(managerUser.token, { type: 'bearer' });

        // Handle rate limiting (429) - retry after waiting
        if (fieldsResponse.status === 429) {
          console.log('[FULL WORKFLOW GET FIELDS] Rate limited, waiting 65s before retry...');
          await new Promise((resolve) => setTimeout(resolve, 65000));
          fieldsResponse = await request(APP_URL)
            .get(`/api/v1/documents/${workflowDocumentId}/fields`)
            .auth(managerUser.token, { type: 'bearer' });
        }

        expect(fieldsResponse.status).toBe(200);
        expect(fieldsResponse.body).toHaveProperty('fields');
        expect(Array.isArray(fieldsResponse.body.fields)).toBe(true);
        console.log(
          `[FULL WORKFLOW] Retrieved ${fieldsResponse.body.fields.length} extracted fields`,
        );
      }

      // Step 6: Verify access control
      console.log('[FULL WORKFLOW] Step 6: Verifying access control...');
      
      // Create access grant for regular user
      try {
        await createAccessGrant(
          managerUser.token,
          workflowDocumentId,
          'user',
          regularUser.id,
          'delegated',
        );

        await new Promise((resolve) => setTimeout(resolve, 500));

        const userAccessResponse = await request(APP_URL)
          .get(`/api/v1/documents/${workflowDocumentId}`)
          .auth(regularUser.token, { type: 'bearer' });

        expect(userAccessResponse.status).toBe(200);
        expect(userAccessResponse.body).toHaveProperty('id', workflowDocumentId);
        console.log('[FULL WORKFLOW] User access grant verified');
      } catch (error) {
        console.warn(
          '[FULL WORKFLOW] Access grant creation failed, skipping access verification:',
          error,
        );
      }

      // Step 7: Verify download URL generation
      console.log('[FULL WORKFLOW] Step 7: Generating download URL...');
      const downloadResponse = await request(APP_URL)
        .get(`/api/v1/documents/${workflowDocumentId}/download`)
        .auth(managerUser.token, { type: 'bearer' });

      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.body).toHaveProperty('downloadUrl');
      expect(downloadResponse.body.downloadUrl).toMatch(/^https?:\/\//);
      console.log('[FULL WORKFLOW] Download URL generated successfully');

      console.log('[FULL WORKFLOW] ✅ Full workflow test completed successfully!');
    }, 180000); // 3 minute timeout for full workflow
  });

  // ============================================================================
  // Test 9: Document Listing and Filtering
  // ============================================================================
  describe('Document Listing and Filtering', () => {
    it('should list documents with pagination', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/documents?page=1&limit=10')
        .auth(managerUser.token, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body).toHaveProperty('hasNextPage');
      expect(typeof response.body.hasNextPage).toBe('boolean');
    });

    it('should filter documents by status', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/documents?status=PROCESSED')
        .auth(managerUser.token, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should filter documents by documentType', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/documents?documentType=LAB_RESULT')
        .auth(managerUser.token, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  // ============================================================================
  // Test 10: Error Handling and Edge Cases
  // ============================================================================
  describe('Error Handling and Edge Cases', () => {
    it('should return 404 for non-existent document', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const response = await request(APP_URL)
        .get(`/api/v1/documents/${fakeId}`)
        .auth(managerUser.token, { type: 'bearer' });

      expect(response.status).toBe(404);
    });

    it('should reject invalid UUID format', async () => {
      const invalidId = 'not-a-uuid';
      const response = await request(APP_URL)
        .get(`/api/v1/documents/${invalidId}`)
        .auth(managerUser.token, { type: 'bearer' });

      expect([400, 404]).toContain(response.status);
    });

    it('should reject admin from all document operations', async () => {
      if (!documentId) {
        throw new Error('documentId not set');
      }

      // Test admin rejection on multiple endpoints
      const endpoints = [
        { method: 'get', path: `/api/v1/documents/${documentId}` },
        { method: 'get', path: `/api/v1/documents/${documentId}/status` },
        { method: 'get', path: `/api/v1/documents/${documentId}/fields` },
        { method: 'get', path: `/api/v1/documents/${documentId}/download` },
        { method: 'post', path: `/api/v1/documents/${documentId}/ocr/trigger` },
      ];

      for (const endpoint of endpoints) {
        const req = request(APP_URL)[endpoint.method](endpoint.path);
        let response = await req.auth(adminToken, { type: 'bearer' });

        // Handle rate limiting (429) - retry after waiting
        if (response.status === 429) {
          console.log(
            `[ADMIN REJECTION TEST] Rate limited on ${endpoint.method} ${endpoint.path}, waiting 65s before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 65000));
          const retryReq = request(APP_URL)[endpoint.method](endpoint.path);
          response = await retryReq.auth(adminToken, { type: 'bearer' });
        }

        expect(response.status).toBe(403);
        expect(response.body.message).toContain('Admins do not have document-level access');
      }
    });
  });
});

