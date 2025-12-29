import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  createTestUser,
  getAdminToken,
  uploadTestDocument,
  createAccessGrant,
  TestUser,
} from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

describe('Revocation Request Endpoints (E2E)', () => {
  let adminToken: string;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let otherUser: TestUser;
  let documentId: string;
  let requestId: number;

  beforeAll(async () => {
    adminToken = await getAdminToken();
    managerUser = await createTestUser(RoleEnum.manager, 'manager');
    regularUser = await createTestUser(RoleEnum.user, 'user');
    otherUser = await createTestUser(RoleEnum.user, 'other-user');

    // Upload a document as manager
    const result = await uploadTestDocument(managerUser.token, managerUser.id);
    documentId = result.documentId;

    // Grant access to regular user
    await createAccessGrant(
      managerUser.token,
      documentId,
      'user',
      regularUser.id,
    );
  });

  describe('POST /v1/documents/:id/revocation-requests', () => {
    it('should allow user to create revocation request', async () => {
      const response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/revocation-requests`)
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          requestType: 'self_revocation',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('documentId', documentId);
      expect(response.body).toHaveProperty('status', 'pending');
      expect(response.body).toHaveProperty('requestType', 'self_revocation');

      requestId = response.body.id;
    });

    it('should allow manager to create revocation request', async () => {
      const response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/revocation-requests`)
        .auth(managerUser.token, { type: 'bearer' })
        .send({
          requestType: 'manager_revocation',
          cascadeToSecondaryManagers: true,
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('cascadeToSecondaryManagers', true);
    });

    it('should reject admin from creating revocation requests', async () => {
      await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/revocation-requests`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          requestType: 'self_revocation',
        })
        .expect(403);
    });

    it('should validate required fields', async () => {
      await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/revocation-requests`)
        .auth(regularUser.token, { type: 'bearer' })
        .send({})
        .expect(400);
    });
  });

  describe('GET /v1/revocation-requests', () => {
    it('should allow user to list their own requests', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/revocation-requests')
        .auth(regularUser.token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should allow admin to list all requests', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/revocation-requests')
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('GET /v1/revocation-requests/:id', () => {
    it('should allow requester to get their request', async () => {
      const response = await request(APP_URL)
        .get(`/api/v1/revocation-requests/${requestId}`)
        .auth(regularUser.token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('id', requestId);
      expect(response.body).toHaveProperty('documentId');
    });

    it('should allow admin to get any request', async () => {
      const response = await request(APP_URL)
        .get(`/api/v1/revocation-requests/${requestId}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('id', requestId);
    });
  });

  describe('PATCH /v1/revocation-requests/:id (approve)', () => {
    it('should allow origin manager to approve request', async () => {
      // Create a new request to approve
      const createResponse = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/revocation-requests`)
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          requestType: 'self_revocation',
        })
        .expect(201);

      // Per Phase 3 plan: PATCH /v1/revocation-requests/:id (with status in body)
      const response = await request(APP_URL)
        .patch(`/api/v1/revocation-requests/${createResponse.body.id}`)
        .auth(managerUser.token, { type: 'bearer' })
        .send({
          status: 'approved',
          reviewNotes: 'Approved as requested',
        })
        .expect(200);

      expect(response.body).toHaveProperty('status', 'approved');
      expect(response.body).toHaveProperty('reviewedBy');
    });

    it('should reject admin from approving requests', async () => {
      await request(APP_URL)
        .patch(`/api/v1/revocation-requests/${requestId}`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          status: 'approved',
          reviewNotes: 'Approved',
        })
        .expect(403);
    });

    it('should reject non-origin manager from approving requests', async () => {
      const otherManager = await createTestUser(
        RoleEnum.manager,
        'other-manager',
      );
      await request(APP_URL)
        .patch(`/api/v1/revocation-requests/${requestId}`)
        .auth(otherManager.token, { type: 'bearer' })
        .send({
          status: 'approved',
          reviewNotes: 'Approved',
        })
        .expect(403);
    });
  });

  describe('PATCH /v1/revocation-requests/:id (deny)', () => {
    it('should allow origin manager to deny request', async () => {
      // Create a new request to deny
      const createResponse = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/revocation-requests`)
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          requestType: 'self_revocation',
        })
        .expect(201);

      // Per Phase 3 plan: PATCH /v1/revocation-requests/:id (with status in body)
      const response = await request(APP_URL)
        .patch(`/api/v1/revocation-requests/${createResponse.body.id}`)
        .auth(managerUser.token, { type: 'bearer' })
        .send({
          status: 'denied',
          reviewNotes: 'Denied - access still needed',
        })
        .expect(200);

      expect(response.body).toHaveProperty('status', 'denied');
    });

    it('should reject admin from denying requests', async () => {
      await request(APP_URL)
        .patch(`/api/v1/revocation-requests/${requestId}`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          status: 'denied',
          reviewNotes: 'Denied',
        })
        .expect(403);
    });
  });

  describe('DELETE /v1/revocation-requests/:id (cancel)', () => {
    it('should allow requester to cancel their request', async () => {
      // Create a new request to cancel
      const createResponse = await request(APP_URL)
        .post(`/api/v1/documents/${documentId}/revocation-requests`)
        .auth(regularUser.token, { type: 'bearer' })
        .send({
          requestType: 'self_revocation',
        })
        .expect(201);

      await request(APP_URL)
        .delete(`/api/v1/revocation-requests/${createResponse.body.id}`)
        .auth(regularUser.token, { type: 'bearer' })
        .expect(204);
    });

    it('should reject non-requester from canceling request', async () => {
      await request(APP_URL)
        .delete(`/api/v1/revocation-requests/${requestId}`)
        .auth(otherUser.token, { type: 'bearer' })
        .expect(403);
    });
  });
});
