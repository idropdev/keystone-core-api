import request from 'supertest';

/**
 * E2E Tests for AnythingLLM Admin Proxy Endpoints
 *
 * These tests verify the Keystone admin proxy endpoints that forward
 * requests to AnythingLLM.
 *
 * Prerequisites:
 * 1. Keystone API must be running (npm run start:dev)
 * 2. ANYTHINGLLM_BASE_URL must be set in environment
 * 3. TEST_SERVICE_TOKEN must be set with a valid GCP service identity token
 *
 * To generate a test service token:
 *   node -e "require('google-auth-library').GoogleAuth().getIdTokenClient('anythingllm-internal').then(c => c.idTokenProvider.fetchIdToken('anythingllm-internal').then(console.log))"
 *
 * Or export from runtime logs when starting keystone (the minted token is logged)
 *
 * To run these tests:
 *   TEST_SERVICE_TOKEN=<token> npm run test:e2e -- admin-proxy
 *
 * To skip tests if AnythingLLM is not available:
 *   SKIP_ANYTHINGLLM_TESTS=true npm run test:e2e -- admin-proxy
 */
describe('AnythingLLM Admin Proxy (E2E)', () => {
  const app = process.env.APP_URL || 'http://localhost:3000';
  const skipTests = process.env.SKIP_ANYTHINGLLM_TESTS === 'true';
  const anythingllmBaseUrl = process.env.ANYTHINGLLM_BASE_URL;
  const serviceToken = process.env.TEST_SERVICE_TOKEN;

  // Track created resources for cleanup
  const createdUserIds: number[] = [];
  const createdInviteIds: number[] = [];

  /**
   * Check if tests can run with authentication
   */
  function canRunAuthenticatedTests(): boolean {
    if (skipTests) {
      console.log('Skipping test - SKIP_ANYTHINGLLM_TESTS=true');
      return false;
    }
    if (!anythingllmBaseUrl) {
      console.log('Skipping test - ANYTHINGLLM_BASE_URL not set');
      return false;
    }
    if (!serviceToken) {
      console.log('Skipping test - TEST_SERVICE_TOKEN not set');
      console.log('To generate a token, run:');
      console.log(
        "  node -e \"require('google-auth-library').GoogleAuth().getIdTokenClient('anythingllm-internal').then(c => c.idTokenProvider.fetchIdToken('anythingllm-internal').then(console.log))\"",
      );
      return false;
    }
    return true;
  }

  /**
   * Helper to get a mock user JWT token for rejection tests
   */
  function getMockUserJwt(): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-123',
        role: 'default',
        iss: 'keystone',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const signature = 'fake-signature';
    return `${header}.${payload}.${signature}`;
  }

  /**
   * Generate unique test username
   */
  function generateTestUsername(): string {
    return `e2e-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  afterAll(async () => {
    if (!canRunAuthenticatedTests()) return;

    // Cleanup created users
    for (const userId of createdUserIds) {
      try {
        await request(app)
          .delete(`/api/anythingllm/admin/users/${userId}`)
          .set('Authorization', `Bearer ${serviceToken}`);
        console.log(`Cleaned up e2e test user: ${userId}`);
      } catch (error) {
        console.log(`Failed to cleanup user ${userId}`);
      }
    }

    // Cleanup created invites
    for (const inviteId of createdInviteIds) {
      try {
        await request(app)
          .delete(`/api/anythingllm/admin/invite/${inviteId}`)
          .set('Authorization', `Bearer ${serviceToken}`);
        console.log(`Cleaned up e2e test invite: ${inviteId}`);
      } catch (error) {
        console.log(`Failed to cleanup invite ${inviteId}`);
      }
    }
  });

  // ============================================================
  // A) Health / Connectivity Tests
  // ============================================================

  describe('Health / Connectivity', () => {
    it('should return multi-user mode status', async () => {
      if (!canRunAuthenticatedTests()) return;

      const response = await request(app)
        .get('/api/anythingllm/admin/is-multi-user-mode')
        .set('Authorization', `Bearer ${serviceToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('isMultiUser');
      expect(typeof response.body.isMultiUser).toBe('boolean');
    });
  });

  // ============================================================
  // B) Auth Rejection Tests
  // ============================================================

  describe('Auth Rejection', () => {
    it('should reject requests without authorization header', async () => {
      if (skipTests || !anythingllmBaseUrl) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const response = await request(app)
        .get('/api/anythingllm/admin/is-multi-user-mode')
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should reject end-user JWT tokens', async () => {
      if (skipTests || !anythingllmBaseUrl) {
        console.log('Skipping test - prerequisites not met');
        return;
      }

      const mockUserToken = getMockUserJwt();

      const response = await request(app)
        .get('/api/anythingllm/admin/is-multi-user-mode')
        .set('Authorization', `Bearer ${mockUserToken}`);

      // Should be 401 or 403
      expect([401, 403]).toContain(response.status);
    });
  });

  // ============================================================
  // C) Users Lifecycle Tests
  // ============================================================

  describe('Users Lifecycle', () => {
    const testUsername = generateTestUsername();
    let createdUserId: number;

    it('should create a new user', async () => {
      if (!canRunAuthenticatedTests()) return;

      const response = await request(app)
        .post('/api/anythingllm/admin/users/new')
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({
          username: testUsername,
          password: 'E2eTestPassword123!',
          role: 'default',
        })
        .expect(200);

      expect(response.body).toHaveProperty('user');
      if (response.body.user) {
        createdUserId = response.body.user.id;
        createdUserIds.push(createdUserId);
        console.log(`Created e2e test user: ${createdUserId}`);
      }
    });

    it('should list users', async () => {
      if (!canRunAuthenticatedTests()) return;

      const response = await request(app)
        .get('/api/anythingllm/admin/users')
        .set('Authorization', `Bearer ${serviceToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('users');
      expect(Array.isArray(response.body.users)).toBe(true);
    });

    it('should update user', async () => {
      if (!canRunAuthenticatedTests() || !createdUserId) {
        if (!createdUserId) console.log('Skipping test - no user created');
        return;
      }

      const response = await request(app)
        .post(`/api/anythingllm/admin/users/${createdUserId}`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({ role: 'manager' })
        .expect(200);

      expect(response.body).toHaveProperty('success');
    });

    it('should delete user', async () => {
      if (!canRunAuthenticatedTests() || !createdUserId) {
        if (!createdUserId) console.log('Skipping test - no user created');
        return;
      }

      const response = await request(app)
        .delete(`/api/anythingllm/admin/users/${createdUserId}`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success');

      // Remove from cleanup list
      const idx = createdUserIds.indexOf(createdUserId);
      if (idx > -1) createdUserIds.splice(idx, 1);
    });
  });

  // ============================================================
  // D) Invites Lifecycle Tests
  // ============================================================

  describe('Invites Lifecycle', () => {
    let createdInviteId: number;

    it('should create a new invite', async () => {
      if (!canRunAuthenticatedTests()) return;

      const response = await request(app)
        .post('/api/anythingllm/admin/invite/new')
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({ workspaceIds: [] })
        .expect(200);

      expect(response.body).toHaveProperty('invite');
      if (response.body.invite) {
        createdInviteId = response.body.invite.id;
        createdInviteIds.push(createdInviteId);
        console.log(`Created e2e test invite: ${createdInviteId}`);
      }
    });

    it('should list invites', async () => {
      if (!canRunAuthenticatedTests()) return;

      const response = await request(app)
        .get('/api/anythingllm/admin/invites')
        .set('Authorization', `Bearer ${serviceToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('invites');
      expect(Array.isArray(response.body.invites)).toBe(true);
    });

    it('should revoke invite', async () => {
      if (!canRunAuthenticatedTests() || !createdInviteId) {
        if (!createdInviteId) console.log('Skipping test - no invite created');
        return;
      }

      const response = await request(app)
        .delete(`/api/anythingllm/admin/invite/${createdInviteId}`)
        .set('Authorization', `Bearer ${serviceToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success');

      // Remove from cleanup list
      const idx = createdInviteIds.indexOf(createdInviteId);
      if (idx > -1) createdInviteIds.splice(idx, 1);
    });
  });

  // ============================================================
  // E) Workspace Chats Tests
  // ============================================================

  describe('Workspace Chats', () => {
    it('should get workspace chats', async () => {
      if (!canRunAuthenticatedTests()) return;

      const response = await request(app)
        .post('/api/anythingllm/admin/workspace-chats')
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({ offset: 0 })
        .expect(200);

      expect(response.body).toHaveProperty('chats');
      expect(response.body).toHaveProperty('hasPages');
    });
  });

  // ============================================================
  // F) Preferences Tests
  // ============================================================

  describe('Preferences', () => {
    it('should update system preferences', async () => {
      if (!canRunAuthenticatedTests()) return;

      const response = await request(app)
        .post('/api/anythingllm/admin/preferences')
        .set('Authorization', `Bearer ${serviceToken}`)
        .send({})
        .expect(200);

      expect(response.body).toHaveProperty('success');
    });
  });
});
