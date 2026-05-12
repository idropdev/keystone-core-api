import request from 'supertest';
import { APP_URL } from '../utils/constants';
import { createTestUser, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

/**
 * GET /auth/me with chatWorkspaceSlug E2E Tests (C4)
 *
 * Verifies the /auth/me endpoint now includes the chatWorkspaceSlug field
 * for use by HealthAtlas chat features.
 */
describe('GET /auth/me with chatWorkspaceSlug (E2E)', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createTestUser(RoleEnum.user, 'me-ws');
  }, 60000);

  it('should include chatWorkspaceSlug in the response', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/auth/me')
      .auth(user.token, { type: 'bearer' })
      .expect(200);
    expect(res.body).toHaveProperty('chatWorkspaceSlug');
    if (res.body.chatWorkspaceSlug !== null) {
      expect(typeof res.body.chatWorkspaceSlug).toBe('string');
      expect(res.body.chatWorkspaceSlug.length).toBeGreaterThan(0);
    }
  });

  it('should preserve existing /me fields (regression check)', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/auth/me')
      .auth(user.token, { type: 'bearer' })
      .expect(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('email');
  });

  it('should return 401 without a JWT', async () => {
    await request(APP_URL).get('/api/v1/auth/me').expect(401);
  });
});
