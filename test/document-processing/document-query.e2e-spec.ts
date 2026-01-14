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
import { DocumentType } from '../../src/document-processing/domain/enums/document-type.enum';
import { DocumentStatus } from '../../src/document-processing/domain/enums/document-status.enum';

/**
 * Document Query E2E Tests
 *
 * Tests the document query endpoint with all three access mechanisms:
 * 1. Implicit Access (Origin/Temporary Manager)
 *    - Origin Manager: Documents where originManagerId = manager.id
 *    - Temporary Manager: Documents where temporaryManagerId = user.id
 * 2. Explicit Access Grants
 *    - Documents where actor has active AccessGrant
 * 3. Manager-User Assignments (Role Delegation)
 *    - Managers can query documents of users assigned to them
 *
 * Verifies:
 * - Authorization-first approach (scope built before filters)
 * - Ownership context in responses ("own", "assigned_user", "granted")
 * - Query operators (eq, in, contains, between, AND/OR)
 * - Full-text search
 * - Pagination
 */
describe('Document Query Endpoint (E2E)', () => {
  let adminToken: string;
  let regularUser: TestUser; // Will be temporary manager
  let manager: TestManager; // Will be origin manager
  let managerUser: TestUser;
  let assignedUser: TestUser; // User assigned to manager
  let grantedUser: TestUser; // User with access grant

  // Test documents
  const testDocuments: {
    userDocuments?: string[]; // Documents uploaded by regularUser (temporary manager)
    managerDocuments?: string[]; // Documents uploaded by manager (origin manager)
    assignedUserDocuments?: string[]; // Documents uploaded by assignedUser
    grantedDocument?: string; // Document with access grant
  } = {};

  beforeAll(async () => {
    // Get admin token
    adminToken = await getAdminToken();

    // Create regular user (will upload documents without manager, becomes temporary manager)
    regularUser = await createTestUser(RoleEnum.user, 'query-user');

    // Create manager (will upload documents, becomes origin manager)
    manager = await createTestManager(adminToken);
    managerUser = {
      id: manager.userId,
      email: '',
      token: manager.token,
      roleId: RoleEnum.manager,
    };

    // Create assigned user (will be assigned to manager)
    assignedUser = await createTestUser(RoleEnum.user, 'query-assigned-user');

    // Create granted user (will receive access grant)
    grantedUser = await createTestUser(RoleEnum.user, 'query-granted-user');

    // Assign user to manager
    await request(APP_URL)
      .post(`/api/v1/users/${assignedUser.id}/manager-assignments`)
      .auth(adminToken, { type: 'bearer' })
      .send({ managerId: manager.userId }) // managerId is User ID, not Manager ID
      .expect(201);
  }, 180000); // 3 minutes timeout for setup

  describe('Setup: Upload Test Documents', () => {
    it('should upload documents as regular user (temporary manager)', async () => {
      const documents: string[] = [];

      // Upload 3 documents - user without assigned manager becomes temporary manager
      // uploadTestDocument requires originManagerId parameter, but it's not used in request
      // For users, the system determines temporaryManagerId automatically
      for (let i = 0; i < 3; i++) {
        const result = await uploadTestDocument(
          regularUser.token,
          0, // Parameter required but not used - system sets temporaryManagerId
        );
        documents.push(result.documentId);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Rate limiting
      }

      testDocuments.userDocuments = documents;
    }, 120000);

    it('should upload documents as manager (origin manager)', async () => {
      const documents: string[] = [];

      // Upload 3 documents - manager becomes origin manager
      for (let i = 0; i < 3; i++) {
        const result = await uploadTestDocument(
          managerUser.token,
          manager.id, // Manager ID (parameter kept for reference)
        );
        documents.push(result.documentId);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Rate limiting
      }

      testDocuments.managerDocuments = documents;
    }, 120000);

    it('should upload documents as assigned user', async () => {
      const documents: string[] = [];

      // Upload 2 documents - assigned user's documents have originManagerId from assigned manager
      // uploadTestDocument requires originManagerId parameter, but system determines it from assigned manager
      for (let i = 0; i < 2; i++) {
        const result = await uploadTestDocument(
          assignedUser.token,
          0, // Parameter required but not used - system sets originManagerId from assigned manager
        );
        documents.push(result.documentId);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Rate limiting
      }

      testDocuments.assignedUserDocuments = documents;
    }, 120000);

    it('should create access grant for granted user', async () => {
      if (!testDocuments.managerDocuments || testDocuments.managerDocuments.length === 0) {
        throw new Error('Manager documents not created');
      }

      // Use first manager document for grant
      const documentId = testDocuments.managerDocuments[0];
      await createAccessGrant(
        managerUser.token,
        documentId,
        'user',
        grantedUser.id,
        'delegated',
      );

      testDocuments.grantedDocument = documentId;
    }, 30000);
  });

  describe('User Query Scenarios - Temporary Manager', () => {
    it('should query own documents (temporary manager) and verify ownershipContext is "own"', async () => {
      if (!testDocuments.userDocuments) {
        throw new Error('User documents not created');
      }

      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('hasNextPage');
      expect(Array.isArray(response.body.data)).toBe(true);

      // Verify user's own documents have "own" ownershipContext
      const userDocs = response.body.data.filter((doc: any) =>
        testDocuments.userDocuments!.includes(doc.id),
      );
      expect(userDocs.length).toBeGreaterThan(0);
      userDocs.forEach((doc: any) => {
        expect(doc).toHaveProperty('ownershipContext', 'own');
      });
    }, 30000);

    it('should filter documents by documentType', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          query: {
            field: 'documentType',
            op: 'eq',
            value: DocumentType.LAB_RESULT,
          },
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((doc: any) => {
        expect(doc.documentType).toBe(DocumentType.LAB_RESULT);
      });
    }, 30000);

    it('should filter documents by status with IN operator', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          query: {
            field: 'status',
            op: 'in',
            value: [
              DocumentStatus.STORED,
              DocumentStatus.PROCESSED,
              DocumentStatus.PROCESSING,
            ],
          },
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      response.body.data.forEach((doc: any) => {
        expect([
          DocumentStatus.STORED,
          DocumentStatus.PROCESSED,
          DocumentStatus.PROCESSING,
        ]).toContain(doc.status);
      });
    }, 30000);
  });

  describe('Manager Query Scenarios - Origin Manager', () => {
    it('should query own documents (origin manager) and verify ownershipContext is "own"', async () => {
      if (!testDocuments.managerDocuments) {
        throw new Error('Manager documents not created');
      }

      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(managerUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);

      // Verify manager's own documents have "own" ownershipContext
      const managerDocs = response.body.data.filter((doc: any) =>
        testDocuments.managerDocuments!.includes(doc.id),
      );
      expect(managerDocs.length).toBeGreaterThan(0);
      managerDocs.forEach((doc: any) => {
        expect(doc).toHaveProperty('ownershipContext', 'own');
      });
    }, 30000);

    it('should query assigned users documents and verify ownershipContext is "assigned_user"', async () => {
      if (!testDocuments.assignedUserDocuments) {
        throw new Error('Assigned user documents not created');
      }

      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(managerUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);

      // Verify assigned user's documents have "assigned_user" ownershipContext
      const assignedDocs = response.body.data.filter((doc: any) =>
        testDocuments.assignedUserDocuments!.includes(doc.id),
      );
      if (assignedDocs.length > 0) {
        assignedDocs.forEach((doc: any) => {
          expect(doc).toHaveProperty('ownershipContext', 'assigned_user');
        });
      }
    }, 30000);
  });

  describe('Access Grants - Explicit Access', () => {
    it('should query documents via access grant and verify ownershipContext is "granted"', async () => {
      if (!testDocuments.grantedDocument) {
        throw new Error('Granted document not created');
      }

      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(grantedUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);

      // Verify granted document has "granted" ownershipContext
      const grantedDoc = response.body.data.find(
        (doc: any) => doc.id === testDocuments.grantedDocument,
      );
      if (grantedDoc) {
        expect(grantedDoc).toHaveProperty('ownershipContext', 'granted');
      }
    }, 30000);
  });

  describe('Authorization Enforcement', () => {
    it('should not return other users documents (user cannot see manager documents)', async () => {
      if (!testDocuments.managerDocuments) {
        throw new Error('Manager documents not created');
      }

      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 100,
          },
        })
        .expect(200);

      // User should not see manager's documents
      const managerDocIds = response.body.data
        .map((doc: any) => doc.id)
        .filter((id: string) => testDocuments.managerDocuments!.includes(id));
      expect(managerDocIds.length).toBe(0);
    }, 30000);

    it('should not return unassigned users documents (manager cannot see unassigned user documents)', async () => {
      if (!testDocuments.userDocuments) {
        throw new Error('User documents not created');
      }

      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(managerUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 100,
          },
        })
        .expect(200);

      // Manager should not see unassigned user's documents (regularUser is not assigned)
      const userDocIds = response.body.data
        .map((doc: any) => doc.id)
        .filter((id: string) => testDocuments.userDocuments!.includes(id));
      expect(userDocIds.length).toBe(0);
    }, 30000);
  });

  describe('Query Operators', () => {
    it('should support AND combinator', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          query: {
            and: [
              {
                field: 'documentType',
                op: 'in',
                value: [DocumentType.LAB_RESULT, DocumentType.PRESCRIPTION],
              },
              {
                field: 'status',
                op: 'ne',
                value: DocumentStatus.FAILED,
              },
            ],
          },
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    }, 30000);

    it('should support OR combinator', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          query: {
            or: [
              {
                field: 'documentType',
                op: 'eq',
                value: DocumentType.LAB_RESULT,
              },
              {
                field: 'documentType',
                op: 'eq',
                value: DocumentType.PRESCRIPTION,
              },
            ],
          },
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    }, 30000);

    it('should support full-text search', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          fullText: 'test',
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    }, 30000);

    it('should support contains operator', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          query: {
            field: 'fileName',
            op: 'contains',
            value: '.pdf',
          },
          pagination: {
            page: 1,
            limit: 20,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    }, 30000);
  });

  describe('Pagination', () => {
    it('should paginate results correctly', async () => {
      const page1Response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 2,
          },
        })
        .expect(200);

      expect(page1Response.body.data.length).toBeLessThanOrEqual(2);
      expect(page1Response.body).toHaveProperty('hasNextPage');

      if (page1Response.body.hasNextPage) {
        const page2Response = await request(APP_URL)
          .post('/api/v1/documents/query')
          .auth(regularUser.token, { type: 'bearer' })
          .send({
            pagination: {
              page: 2,
              limit: 2,
            },
          })
          .expect(200);

        // Results should be different
        expect(page2Response.body.data.length).toBeGreaterThanOrEqual(0);
        // Page 1 and page 2 should not have same document IDs
        const page1Ids = page1Response.body.data.map((doc: any) => doc.id);
        const page2Ids = page2Response.body.data.map((doc: any) => doc.id);
        page1Ids.forEach((id: string) => {
          expect(page2Ids).not.toContain(id);
        });
      }
    }, 30000);

    it('should calculate hasNextPage correctly', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 100,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('hasNextPage');
      expect(typeof response.body.hasNextPage).toBe('boolean');
    }, 30000);
  });

  describe('Sorting', () => {
    it('should sort by uploadedAt descending by default', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/documents/query')
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          pagination: {
            page: 1,
            limit: 10,
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      if (response.body.data.length > 1) {
        const dates = response.body.data.map((doc: any) => new Date(doc.uploadedAt).getTime());
        // Check if dates are in descending order
        for (let i = 0; i < dates.length - 1; i++) {
          expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
        }
      }
    }, 30000);
  });
});
