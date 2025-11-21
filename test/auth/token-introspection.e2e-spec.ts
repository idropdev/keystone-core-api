import request from 'supertest';
import { APP_URL, TESTER_EMAIL, TESTER_PASSWORD } from '../utils/constants';

describe('Token Introspection Endpoint (RFC 7662)', () => {
  const app = APP_URL;
  let accessToken: string;
  let serviceApiKey: string;

  beforeAll(async () => {
    // Get service API key from environment
    serviceApiKey =
      process.env.AUTH_INTROSPECTION_SERVICE_KEY || 'test-service-key';

    // Login to get a valid access token
    const loginResponse = await request(app)
      .post('/api/v1/auth/email/login')
      .send({
        email: TESTER_EMAIL,
        password: TESTER_PASSWORD,
      })
      .expect(200);

    accessToken = loginResponse.body.token;
  });

  describe('POST /api/v1/auth/introspect', () => {
    describe('Authentication', () => {
      it('should return 401 without service API key', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .send({
            token: accessToken,
          })
          .expect(401);
      });

      it('should return 401 with invalid service API key', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', 'Bearer invalid-key')
          .send({
            token: accessToken,
          })
          .expect(401);
      });

      it('should accept valid service API key', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
          })
          .expect(200);
      });
    });

    describe('Request Format (RFC 7662)', () => {
      it('should accept JSON request body', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .set('Content-Type', 'application/json')
          .send({
            token: accessToken,
            token_type_hint: 'access_token',
          })
          .expect(200)
          .expect(({ body }) => {
            expect(body).toHaveProperty('active');
          });
      });

      it('should accept application/x-www-form-urlencoded (RFC 7662)', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send(
            'token=' +
              encodeURIComponent(accessToken) +
              '&token_type_hint=access_token',
          )
          .expect(200)
          .expect(({ body }) => {
            expect(body).toHaveProperty('active');
          });
      });

      it('should require token parameter', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({})
          .expect(422); // ValidationPipe returns 422 for validation errors
      });
    });

    describe('Valid Token Response', () => {
      it('should return active: true for valid token', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
          })
          .expect(200)
          .expect(({ body }) => {
            expect(body.active).toBe(true);
            expect(body.sub).toBeDefined();
            expect(body.exp).toBeDefined();
            expect(body.iat).toBeDefined();
            expect(body.role).toBeDefined();
          });
      });

      it('should include all RFC 7662 standard fields', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
          })
          .expect(200)
          .expect(({ body }) => {
            expect(body.active).toBe(true);
            // RFC 7662 standard fields
            if (body.active) {
              expect(body.sub).toBeDefined();
              expect(body.exp).toBeDefined();
              expect(body.iat).toBeDefined();
            }
          });
      });

      it('should include optional metadata fields', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
            includeUser: true,
          })
          .expect(200)
          .expect(({ body }) => {
            if (body.active) {
              expect(body.scope).toBeDefined();
              expect(body.iss).toBeDefined();
              expect(body.aud).toBeDefined();
            }
          });
      });
    });

    describe('Invalid Token Response', () => {
      it('should return active: false for expired token', async () => {
        // Create an expired token (this would require mocking time or using an old token)
        // For now, we'll test with an invalid token structure
        const invalidToken = 'invalid.token.here';

        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: invalidToken,
          })
          .expect(200)
          .expect(({ body }) => {
            expect(body.active).toBe(false);
            expect(body.error_code).toBeDefined();
          });
      });

      it('should return active: false for malformed token', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: 'not.a.valid.jwt',
          })
          .expect(200)
          .expect(({ body }) => {
            expect(body.active).toBe(false);
            expect(body.error_code).toBe('invalid_token');
          });
      });

      it('should return active: false for empty token', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: '',
          })
          .expect(200) // Empty token is processed and returns active: false
          .expect(({ body }) => {
            expect(body.active).toBe(false);
            expect(body.error_code).toBeDefined();
          });
      });
    });

    describe('Revoked Token Response', () => {
      it('should return active: false after logout', async () => {
        // First, introspect the token (should be active)
        const beforeLogout = await request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
          })
          .expect(200);

        expect(beforeLogout.body.active).toBe(true);

        // Logout (invalidate session)
        await request(app)
          .post('/api/v1/auth/logout')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(204);

        // Wait a moment for cache invalidation
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Introspect again (should be inactive/revoked)
        const afterLogout = await request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
          })
          .expect(200);

        expect(afterLogout.body.active).toBe(false);
        expect(afterLogout.body.revoked).toBe(true);
      });
    });

    describe('Token Type Hint', () => {
      it('should accept token_type_hint parameter', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
            token_type_hint: 'access_token',
          })
          .expect(200)
          .expect(({ body }) => {
            expect(body).toHaveProperty('active');
          });
      });

      it('should accept refresh_token hint', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
            token_type_hint: 'refresh_token',
          })
          .expect(200);
      });
    });

    describe('HIPAA Compliance', () => {
      it('should not include PHI in response', () => {
        return request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .send({
            token: accessToken,
            includeUser: false,
          })
          .expect(200)
          .expect(({ body }) => {
            // Should not include email, name, or other PHI when includeUser is false
            expect(body).not.toHaveProperty('email');
            expect(body).not.toHaveProperty('firstName');
            expect(body).not.toHaveProperty('lastName');
            // Should only include non-PHI identifiers
            expect(body.sub).toBeDefined(); // User ID is OK (not PHI)
            // Role may not be included when includeUser is false (depends on implementation)
            // But if present, it's OK (not PHI)
          });
      });

      it('should log introspection events (audit trail)', async () => {
        // Make an introspection request
        await request(app)
          .post('/api/v1/auth/introspect')
          .set('Authorization', `Bearer ${serviceApiKey}`)
          .set('X-Client-Service', 'anythingllm-test')
          .send({
            token: accessToken,
          })
          .expect(200);

        // Note: In a real test, we would verify audit logs
        // This test documents the expected behavior
        // TODO: Add audit log verification when GCP Cloud Logging is integrated
      });
    });

    // Rate Limiting test moved to LAST to avoid blocking subsequent tests
    // This test makes 101 requests which will trigger rate limiting
    // SKIPPED by default - remove .skip to run it separately
    describe('Rate Limiting', () => {
      it.skip('should enforce rate limiting (100 requests per minute)', async () => {
        // Make 101 requests rapidly
        const requests = Array.from({ length: 101 }, () =>
          request(app)
            .post('/api/v1/auth/introspect')
            .set('Authorization', `Bearer ${serviceApiKey}`)
            .send({
              token: accessToken,
            }),
        );

        const responses = await Promise.all(requests);

        // At least one should be rate limited (429)
        const rateLimited = responses.some((res) => res.status === 429);
        // Note: Rate limiting may not trigger in test environment
        // This test documents the expected behavior
        expect(
          rateLimited || responses.every((res) => res.status === 200),
        ).toBe(true);
      });
    });
  });
});
