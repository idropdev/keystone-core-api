import request from 'supertest';
import { APP_URL } from '../utils/constants';
import { createTestUser, getAdminToken, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

describe('Manager Assignment Endpoints (E2E)', () => {
  let adminToken: string;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let assignmentId: number;

  beforeAll(async () => {
    adminToken = await getAdminToken();
    managerUser = await createTestUser(RoleEnum.manager, 'manager');
    regularUser = await createTestUser(RoleEnum.user, 'user');
  });

  describe('POST /v1/users/:userId/manager-assignments', () => {
    it('should allow admin to assign user to manager', async () => {
      const response = await request(APP_URL)
        .post(`/api/v1/users/${regularUser.id}/manager-assignments`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          managerId: managerUser.id,
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('userId', regularUser.id);
      expect(response.body).toHaveProperty('managerId', managerUser.id);

      assignmentId = response.body.id;
    });

    it('should reject non-admin from creating assignments', async () => {
      const otherUser = await createTestUser(RoleEnum.user, 'other-user');
      await request(APP_URL)
        .post(`/api/v1/users/${regularUser.id}/manager-assignments`)
        .auth(otherUser.token, { type: 'bearer' })
        .send({
          managerId: managerUser.id,
        })
        .expect(403);
    });

    it('should reject manager from creating assignments', async () => {
      await request(APP_URL)
        .post(`/api/v1/users/${regularUser.id}/manager-assignments`)
        .auth(managerUser.token, { type: 'bearer' })
        .send({
          managerId: managerUser.id,
        })
        .expect(403);
    });

    it('should validate required fields', async () => {
      await request(APP_URL)
        .post(`/api/v1/users/${regularUser.id}/manager-assignments`)
        .auth(adminToken, { type: 'bearer' })
        .send({})
        .expect(400);
    });
  });

  describe('GET /v1/users/:userId/manager-assignments', () => {
    it('should allow admin to list user assignments', async () => {
      const response = await request(APP_URL)
        .get(`/api/v1/users/${regularUser.id}/manager-assignments`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should reject non-admin from listing assignments', async () => {
      await request(APP_URL)
        .get(`/api/v1/users/${regularUser.id}/manager-assignments`)
        .auth(regularUser.token, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('GET /v1/users/managers/:managerId/assigned-users', () => {
    it('should allow admin to list assigned users for manager', async () => {
      const response = await request(APP_URL)
        .get(`/api/v1/users/managers/${managerUser.id}/assigned-users`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should reject non-admin from listing assigned users', async () => {
      await request(APP_URL)
        .get(`/api/v1/users/managers/${managerUser.id}/assigned-users`)
        .auth(managerUser.token, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('DELETE /v1/users/:userId/manager-assignments/:managerId', () => {
    it('should allow admin to remove assignment', async () => {
      await request(APP_URL)
        .delete(
          `/api/v1/users/${regularUser.id}/manager-assignments/${managerUser.id}`,
        )
        .auth(adminToken, { type: 'bearer' })
        .expect(204);
    });

    it('should reject non-admin from removing assignments', async () => {
      // Re-create assignment first
      await request(APP_URL)
        .post(`/api/v1/users/${regularUser.id}/manager-assignments`)
        .auth(adminToken, { type: 'bearer' })
        .send({ managerId: managerUser.id })
        .expect(201);

      await request(APP_URL)
        .delete(
          `/api/v1/users/${regularUser.id}/manager-assignments/${managerUser.id}`,
        )
        .auth(regularUser.token, { type: 'bearer' })
        .expect(403);
    });
  });
});
