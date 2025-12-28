import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  createTestUser,
  getAdminToken,
  uploadTestDocument,
  TestUser,
} from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

describe('Audit Query Endpoints (E2E)', () => {
  let adminToken: string;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let documentId: string;

  beforeAll(async () => {
    adminToken = await getAdminToken();
    managerUser = await createTestUser(RoleEnum.manager, 'manager');
    regularUser = await createTestUser(RoleEnum.user, 'user');

    // Upload a document to generate audit events
    const result = await uploadTestDocument(
      managerUser.token,
      managerUser.id,
    );
    documentId = result.documentId;
  });

  describe('GET /v1/audit/events', () => {
    it('should allow admin to query all audit events', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/audit/events')
        .auth(adminToken, { type: 'bearer' })
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should allow origin manager to query events for their documents', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/audit/events')
        .auth(managerUser.token, { type: 'bearer' })
        .query({
          documentId,
          page: 1,
          limit: 10,
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
    });

    it('should reject user from querying audit events', async () => {
      await request(APP_URL)
        .get('/api/v1/audit/events')
        .auth(regularUser.token, { type: 'bearer' })
        .query({ page: 1, limit: 10 })
        .expect(403);
    });

    it('should filter by event type', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/audit/events')
        .auth(adminToken, { type: 'bearer' })
        .query({
          eventType: 'DOCUMENT_UPLOADED',
          page: 1,
          limit: 10,
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });

    it('should filter by date range', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      const endDate = new Date();

      const response = await request(APP_URL)
        .get('/api/v1/audit/events')
        .auth(adminToken, { type: 'bearer' })
        .query({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          page: 1,
          limit: 10,
        })
        .expect(200);

      expect(response.body).toHaveProperty('data');
    });

    it('should validate pagination parameters', async () => {
      await request(APP_URL)
        .get('/api/v1/audit/events')
        .auth(adminToken, { type: 'bearer' })
        .query({ page: 0, limit: 10 })
        .expect(400);
    });
  });

  describe('GET /v1/audit/events/:id', () => {
    it('should allow admin to get specific audit event', async () => {
      // First get list to find an event ID
      const listResponse = await request(APP_URL)
        .get('/api/v1/audit/events')
        .auth(adminToken, { type: 'bearer' })
        .query({ page: 1, limit: 1 })
        .expect(200);

      if (listResponse.body.data.length > 0) {
        const eventId = listResponse.body.data[0].id;

        const response = await request(APP_URL)
          .get(`/api/v1/audit/events/${eventId}`)
          .auth(adminToken, { type: 'bearer' })
          .expect(200);

        expect(response.body).toHaveProperty('id', eventId);
        expect(response.body).toHaveProperty('eventType');
        expect(response.body).toHaveProperty('timestamp');
      }
    });

    it('should allow origin manager to get event for their document', async () => {
      // First get list to find an event ID
      const listResponse = await request(APP_URL)
        .get('/api/v1/audit/events')
        .auth(managerUser.token, { type: 'bearer' })
        .query({
          documentId,
          page: 1,
          limit: 1,
        })
        .expect(200);

      if (listResponse.body.data.length > 0) {
        const eventId = listResponse.body.data[0].id;

        const response = await request(APP_URL)
          .get(`/api/v1/audit/events/${eventId}`)
          .auth(managerUser.token, { type: 'bearer' })
          .expect(200);

        expect(response.body).toHaveProperty('id', eventId);
      }
    });

    it('should reject user from getting audit events', async () => {
      await request(APP_URL)
        .get('/api/v1/audit/events/1')
        .auth(regularUser.token, { type: 'bearer' })
        .expect(403);
    });
  });
});






