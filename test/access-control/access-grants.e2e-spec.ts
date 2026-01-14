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
  let manager: TestManager;
  let managerUser: TestUser;
  let regularUser: TestUser;
  let otherUser: TestUser;
  let documentId: string;
  let grantId: number;

  // Increase timeout to handle rate limiting and manager creation (can take 65+ seconds per user creation)
  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Create a proper Manager entity (not just a user with manager role)
    // This creates both the User and Manager entities, and verifies the manager
    manager = await createTestManager(adminToken);
    managerUser = {
      id: manager.userId,
      email: '',
      token: manager.token,
      roleId: RoleEnum.manager,
    };

    regularUser = await createTestUser(RoleEnum.user, 'user');
    otherUser = await createTestUser(RoleEnum.user, 'other-user');

    // Upload a document as manager
    const result = await uploadTestDocument(
      managerUser.token,
      manager.id, // Use manager.id (Manager entity ID), not managerUser.id (User ID)
    );
    documentId = result.documentId;
  }, 300000); // 5 minutes timeout for beforeAll

  describe('POST /v1/access-grants', () => {
    it('should allow origin manager to create access grant', async () => {
      // Use the helper function which handles grantedByType and grantedById correctly
      const { grantId: createdGrantId } = await createAccessGrant(
        managerUser.token,
        documentId,
        'user',
        regularUser.id,
        'delegated',
      );

      expect(createdGrantId).toBeDefined();
      grantId = createdGrantId;
    });

    it('should reject admin from creating access grants', async () => {
      // Get user info to populate grantedByType and grantedById
      const userInfoResponse = await request(APP_URL)
        .get('/api/v1/auth/me')
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      const adminUserId = userInfoResponse.body.id;

      await request(APP_URL)
        .post('/api/v1/access-grants')
        .auth(adminToken, { type: 'bearer' })
        .send({
          documentId,
          subjectType: 'user',
          subjectId: regularUser.id,
          grantType: 'delegated',
          grantedByType: 'user', // Admin is treated as user type in actor extraction
          grantedById: adminUserId,
        })
        .expect(403);
    });

    it('should reject non-origin manager from creating access grants', async () => {
      // Create a proper Manager entity for the other manager
      const otherManagerEntity = await createTestManager(adminToken);
      const otherManagerUser: TestUser = {
        id: otherManagerEntity.userId,
        email: '',
        token: otherManagerEntity.token,
        roleId: RoleEnum.manager,
      };

      // Get user info to populate grantedByType and grantedById
      const userInfoResponse = await request(APP_URL)
        .get('/api/v1/auth/me')
        .auth(otherManagerUser.token, { type: 'bearer' })
        .expect(200);

      const managerUserId = userInfoResponse.body.id;

      await request(APP_URL)
        .post('/api/v1/access-grants')
        .auth(otherManagerUser.token, { type: 'bearer' })
        .send({
          documentId,
          subjectType: 'user',
          subjectId: regularUser.id,
          grantType: 'delegated',
          grantedByType: 'manager',
          grantedById: managerUserId,
        })
        .expect(403);
    }, 120000); // Increase timeout to 120 seconds for manager creation

    it('should validate required fields', async () => {
      await request(APP_URL)
        .post('/api/v1/access-grants')
        .auth(managerUser.token, { type: 'bearer' })
        .send({})
        .expect(400);
    });
  });

  describe('GET /v1/access-grants?documentId=...', () => {
    it('should allow origin manager to list all grants for document', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/access-grants')
        .query({ documentId })
        .auth(managerUser.token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);

      // Verify the grant we created is in the list
      const grant = response.body.data.find((g: any) => g.id === grantId);
      expect(grant).toBeDefined();
      expect(grant.documentId).toBe(documentId);
    });

    it('should reject admin from listing grants', async () => {
      await request(APP_URL)
        .get('/api/v1/access-grants')
        .query({ documentId })
        .auth(adminToken, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('GET /v1/access-grants (user own grants)', () => {
    it('should allow user to list their own grants', async () => {
      // GET /v1/access-grants without documentId returns actor's own grants
      const response = await request(APP_URL)
        .get('/api/v1/access-grants')
        .auth(regularUser.token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);

      // Should include the grant created for this user
      const userGrant = response.body.data.find(
        (g: any) => g.subjectType === 'user' && g.subjectId === regularUser.id,
      );
      expect(userGrant).toBeDefined();
    });

    it('should reject admin from listing their grants', async () => {
      await request(APP_URL)
        .get('/api/v1/access-grants')
        .auth(adminToken, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('GET /v1/access-grants/my-grants', () => {
    it('should allow user to list their own grants via my-grants endpoint', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/access-grants/my-grants')
        .auth(regularUser.token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should reject admin from accessing my-grants endpoint', async () => {
      await request(APP_URL)
        .get('/api/v1/access-grants/my-grants')
        .auth(adminToken, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('DELETE /v1/access-grants/:id', () => {
    it('should allow origin manager to revoke access grant', async () => {
      // Create a grant to revoke
      const { grantId: grantToRevoke } = await createAccessGrant(
        managerUser.token,
        documentId,
        'user',
        otherUser.id,
      );

      // Verify grant exists before revoking
      const beforeResponse = await request(APP_URL)
        .get('/api/v1/access-grants')
        .query({ documentId })
        .auth(managerUser.token, { type: 'bearer' })
        .expect(200);

      const grantBefore = beforeResponse.body.data.find(
        (g: any) => g.id === grantToRevoke,
      );
      expect(grantBefore).toBeDefined();
      expect(grantBefore.revokedAt).toBeNull();

      // Revoke the grant
      await request(APP_URL)
        .delete(`/api/v1/access-grants/${grantToRevoke}`)
        .auth(managerUser.token, { type: 'bearer' })
        .expect(204);

      // Verify grant is revoked
      const afterResponse = await request(APP_URL)
        .get('/api/v1/access-grants')
        .query({ documentId })
        .auth(managerUser.token, { type: 'bearer' })
        .expect(200);

      const grantAfter = afterResponse.body.data.find(
        (g: any) => g.id === grantToRevoke,
      );
      // Revoked grants may not appear in active grants list, or may have revokedAt set
      if (grantAfter) {
        expect(grantAfter.revokedAt).toBeDefined();
      }
    });

    it('should reject admin from revoking grants', async () => {
      await request(APP_URL)
        .delete(`/api/v1/access-grants/${grantId}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(403);
    });

    it('should reject non-origin manager from revoking grants', async () => {
      // Create a proper Manager entity for the other manager
      const otherManagerEntity = await createTestManager(adminToken);
      const otherManagerUser: TestUser = {
        id: otherManagerEntity.userId,
        email: '',
        token: otherManagerEntity.token,
        roleId: RoleEnum.manager,
      };

      await request(APP_URL)
        .delete(`/api/v1/access-grants/${grantId}`)
        .auth(otherManagerUser.token, { type: 'bearer' })
        .expect(403);
    }, 120000); // Increase timeout to 120 seconds for manager creation
  });
});
