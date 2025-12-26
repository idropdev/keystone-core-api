import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  createTestUser,
  getAdminToken,
  createTestManager,
  uploadTestDocument,
  createAccessGrant,
  TestUser,
  TestManager,
} from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

describe('Access Grant Endpoints (E2E)', () => {
  let adminToken: string;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let otherUser: TestUser;
  let documentId: string;
  let grantId: number;

  beforeAll(async () => {
    adminToken = await getAdminToken();
    managerUser = await createTestUser(RoleEnum.manager, 'manager');
    regularUser = await createTestUser(RoleEnum.user, 'user');
    otherUser = await createTestUser(RoleEnum.user, 'other-user');

    // Upload a document as manager
    const result = await uploadTestDocument(
      managerUser.token,
      managerUser.id,
    );
    documentId = result.documentId;
  });

  describe('POST /v1/documents/:id/access-grants', () => {
    it('should allow origin manager to create access grant', async () => {
      const response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/access-grants`)
        .auth(managerUser.token, { type: 'bearer' })
        .send({
          subjectType: 'user',
          subjectId: regularUser.id,
          grantType: 'delegated',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('documentId', documentId);
      expect(response.body).toHaveProperty('subjectType', 'user');
      expect(response.body).toHaveProperty('subjectId', regularUser.id);
      expect(response.body).toHaveProperty('grantType', 'delegated');

      grantId = response.body.id;
    });

    it('should reject admin from creating access grants', async () => {
      await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/access-grants`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          subjectType: 'user',
          subjectId: regularUser.id,
          grantType: 'delegated',
        })
        .expect(403);
    });

    it('should reject non-origin manager from creating access grants', async () => {
      const otherManager = await createTestUser(RoleEnum.manager, 'other-manager');
      await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/access-grants`)
        .auth(otherManager.token, { type: 'bearer' })
        .send({
          subjectType: 'user',
          subjectId: regularUser.id,
          grantType: 'delegated',
        })
        .expect(403);
    });

    it('should validate required fields', async () => {
      await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/access-grants`)
        .auth(managerUser.token, { type: 'bearer' })
        .send({})
        .expect(400);
    });
  });

  describe('GET /v1/documents/:id/access-grants', () => {
    it('should allow origin manager to list all grants for document', async () => {
      const response = await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/access-grants`)
        .auth(managerUser.token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should reject admin from listing grants', async () => {
      await request(APP_URL)
        .get(`/api/v1/documents/${documentId}/access-grants`)
        .auth(adminToken, { type: 'bearer' })
        .expect(403);
    });
  });

  // NOTE: Phase 3 plan doesn't specify a "my-grants" endpoint
  // The plan specifies GET /v1/documents/:id/access-grants (origin manager only)
  // For listing user's own grants, they would use GET /v1/access-grants (without documentId)
  // But per plan, access grants should be nested under documents
  // This test is kept for backward compatibility but may need to be removed
  describe('GET /v1/access-grants (user own grants)', () => {
    it('should allow user to list their own grants', async () => {
      // Per Phase 3 plan, this should be GET /v1/access-grants (without documentId)
      // But implementation may differ - keeping current path for now
      const response = await request(APP_URL)
        .get('/api/v1/access-grants')
        .auth(regularUser.token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should reject admin from listing their grants', async () => {
      await request(APP_URL)
        .get('/api/v1/access-grants')
        .auth(adminToken, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('DELETE /v1/documents/:id/access-grants/:grantId', () => {
    it('should allow origin manager to revoke access grant', async () => {
      // Create a grant to revoke
      const { grantId: grantToRevoke } = await createAccessGrant(
        managerUser.token,
        documentId,
        'user',
        otherUser.id,
      );

      await request(APP_URL)
        .delete(`/api/v1/documents/${documentId}/access-grants/${grantToRevoke}`)
        .auth(managerUser.token, { type: 'bearer' })
        .expect(204);
    });

    it('should reject admin from revoking grants', async () => {
      await request(APP_URL)
        .delete(`/api/v1/documents/${documentId}/access-grants/${grantId}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(403);
    });

    it('should reject non-origin manager from revoking grants', async () => {
      const otherManager = await createTestUser(RoleEnum.manager, 'other-manager');
      await request(APP_URL)
        .delete(`/api/v1/documents/${documentId}/access-grants/${grantId}`)
        .auth(otherManager.token, { type: 'bearer' })
        .expect(403);
    });
  });
});

