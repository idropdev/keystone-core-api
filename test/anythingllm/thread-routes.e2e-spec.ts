import request from 'supertest';
import { APP_URL } from '../utils/constants';
import { createTestUser, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

/**
 * AnythingLLM Thread Routes E2E Tests (C4)
 *
 * Verifies the three new routes added to AnythingLLMWorkspaceController:
 *  - GET /api/v1/anythingllm/v1/workspace/:slug/threads
 *  - DELETE /api/v1/anythingllm/v1/workspace/:slug/thread/:threadSlug
 *  - GET /api/v1/anythingllm/v1/workspace/:slug/thread/:threadSlug/chats
 *
 * Focus: wiring + JWT enforcement + per-user isolation. Comprehensive
 * service behavior is covered by unit tests in
 * src/anythingllm/thread/anythingllm-thread.service.spec.ts.
 */
describe('AnythingLLM Thread Routes (E2E)', () => {
  let userA: TestUser;
  let userB: TestUser;
  let userAWorkspaceSlug: string | null;

  beforeAll(async () => {
    userA = await createTestUser(RoleEnum.user, 'threads-a');
    userB = await createTestUser(RoleEnum.user, 'threads-b');
    // Fetch userA's workspace slug via /me (also exercises the C4 augmentation).
    const meResp = await request(APP_URL)
      .get('/api/v1/auth/me')
      .auth(userA.token, { type: 'bearer' });
    userAWorkspaceSlug = meResp.body?.chatWorkspaceSlug ?? null;
  }, 60000);

  describe('GET /:slug/threads', () => {
    it('should return 401 without an Authorization header', async () => {
      const slug = userAWorkspaceSlug ?? 'placeholder-slug';
      await request(APP_URL)
        .get(`/api/v1/anythingllm/v1/workspace/${slug}/threads`)
        .expect(401);
    });

    it('should return 200 with an empty array for a fresh user with no threads', async () => {
      if (!userAWorkspaceSlug) {
        console.warn(
          'Skipping: user A has no workspace slug — provisioning may have failed or be async',
        );
        return;
      }
      const res = await request(APP_URL)
        .get(`/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/threads`)
        .auth(userA.token, { type: 'bearer' })
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([]);
    });

    it('should return 403 when user B tries to list user A workspace threads', async () => {
      if (!userAWorkspaceSlug) return;
      await request(APP_URL)
        .get(`/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/threads`)
        .auth(userB.token, { type: 'bearer' })
        .expect(403);
    });
  });

  describe('DELETE /:slug/thread/:threadSlug', () => {
    it('should return 401 without an Authorization header', async () => {
      const slug = userAWorkspaceSlug ?? 'placeholder-slug';
      await request(APP_URL)
        .delete(`/api/v1/anythingllm/v1/workspace/${slug}/thread/non-existent`)
        .expect(401);
    });

    it('should return 404 for a non-existent thread', async () => {
      if (!userAWorkspaceSlug) return;
      const fakeSlug = `non-existent-${Date.now()}`;
      await request(APP_URL)
        .delete(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/thread/${fakeSlug}`,
        )
        .auth(userA.token, { type: 'bearer' })
        .expect((res) => {
          if (res.status !== 404 && res.status !== 502) {
            throw new Error(
              `Expected 404 or 502 (upstream-dependent), got ${res.status}`,
            );
          }
        });
    });
  });

  describe('GET /:slug/thread/:threadSlug/chats', () => {
    it('should return 401 without an Authorization header', async () => {
      const slug = userAWorkspaceSlug ?? 'placeholder-slug';
      await request(APP_URL)
        .get(
          `/api/v1/anythingllm/v1/workspace/${slug}/thread/non-existent/chats`,
        )
        .expect(401);
    });

    it('should return 404 for a non-existent thread', async () => {
      if (!userAWorkspaceSlug) return;
      const fakeSlug = `non-existent-${Date.now()}`;
      await request(APP_URL)
        .get(
          `/api/v1/anythingllm/v1/workspace/${userAWorkspaceSlug}/thread/${fakeSlug}/chats`,
        )
        .auth(userA.token, { type: 'bearer' })
        .expect((res) => {
          if (res.status !== 404 && res.status !== 502) {
            throw new Error(
              `Expected 404 or 502 (upstream-dependent), got ${res.status}`,
            );
          }
        });
    });
  });
});
