import request from 'supertest';
import { APP_URL } from '../utils/constants';
import { createTestUser, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

/**
 * At-a-Glance Summary E2E Tests
 *
 * Verifies the GET /api/v1/at-a-glance/summary endpoint is wired correctly,
 * enforces JWT auth, and isolates users.
 *
 * Note: comprehensive category bucketing logic is covered by the unit tests in
 * `src/at-a-glance/at-a-glance.service.spec.ts` with a mocked repository.
 * This e2e suite focuses on wiring and authorization rather than seeding
 * extracted_fields data (which keystone's existing e2e infra doesn't expose
 * a direct helper for).
 */
describe('At-a-Glance Summary Endpoint (E2E)', () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    userA = await createTestUser(RoleEnum.user, 'atglance-a');
    userB = await createTestUser(RoleEnum.user, 'atglance-b');
  }, 60000);

  it('should return 401 without an Authorization header', async () => {
    await request(APP_URL).get('/api/v1/at-a-glance/summary').expect(401);
  });

  it('should return 401 with an invalid bearer token', async () => {
    await request(APP_URL)
      .get('/api/v1/at-a-glance/summary')
      .auth('not-a-real-token', { type: 'bearer' })
      .expect(401);
  });

  it('should return 200 with the full DTO shape for an authenticated user', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/at-a-glance/summary')
      .auth(userA.token, { type: 'bearer' })
      .expect(200);

    expect(res.body).toHaveProperty('categories');
    expect(res.body).toHaveProperty('last_updated');
    expect(res.body).toHaveProperty('documents_analyzed');

    const cats = res.body.categories;
    for (const c of [
      'medications',
      'allergies',
      'conditions',
      'doctors',
      'pharmacies',
      'insurance',
      'emergency_contact',
    ]) {
      expect(cats).toHaveProperty(c);
      expect(cats[c]).toHaveProperty('count');
      expect(cats[c]).toHaveProperty('samples');
      expect(Array.isArray(cats[c].samples)).toBe(true);
    }
    expect(cats).toHaveProperty('blood_type');
    expect(cats.blood_type).toHaveProperty('value');
    expect(cats.blood_type).toHaveProperty('source_document_id');
  });

  it('should return count 0 across all categories for a user with no documents', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/at-a-glance/summary')
      .auth(userA.token, { type: 'bearer' })
      .expect(200);

    expect(res.body.documents_analyzed).toBe(0);
    expect(res.body.last_updated).toBeNull();
    expect(res.body.categories.medications.count).toBe(0);
    expect(res.body.categories.medications.samples).toEqual([]);
    expect(res.body.categories.blood_type.value).toBeNull();
    expect(res.body.categories.blood_type.source_document_id).toBeNull();
  });

  it('should return independent (empty) summaries for two different users', async () => {
    const [resA, resB] = await Promise.all([
      request(APP_URL)
        .get('/api/v1/at-a-glance/summary')
        .auth(userA.token, { type: 'bearer' }),
      request(APP_URL)
        .get('/api/v1/at-a-glance/summary')
        .auth(userB.token, { type: 'bearer' }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.documents_analyzed).toBe(0);
    expect(resB.body.documents_analyzed).toBe(0);
  });
});
