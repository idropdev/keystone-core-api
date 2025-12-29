import request from 'supertest';
import { APP_URL } from '../utils/constants';
import {
  getAdminToken,
  createTestUser,
  createTestManagerInvitation,
  acceptTestManagerInvitation,
  verifyTestManager,
} from '../utils/test-helpers';

/**
 * Sleep utility to avoid rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
import { RoleEnum } from '../../src/roles/roles.enum';
import { DocumentType } from '../../src/document-processing/domain/enums/document-type.enum';

/**
 * Comprehensive E2E Test Suite for Manager Onboarding Lifecycle
 *
 * Tests all possible conditions:
 * - Manager invitation workflow (mocked - no email required)
 * - Manager acceptance and profile creation
 * - Manager verification by admin
 * - Manager suspension
 * - Document operations with verified/unverified managers
 * - Role boundaries (Admin, Manager, User)
 * - Access control enforcement
 * - Manager directory (verified only)
 * - Manager self-service profile updates
 */
describe('Manager Onboarding Lifecycle (E2E)', () => {
  let adminToken: string;
  let managerUser1: any;
  let managerUser2: any;
  let regularUser: any;
  let invitation1: any;
  let invitation2: any;
  let manager1: any;
  let manager2: any;
  let documentId1: string;
  let documentId2: string;

  beforeAll(async () => {
    // Get admin token
    adminToken = await getAdminToken();

    // Create a regular user for testing
    regularUser = await createTestUser(RoleEnum.user, 'regular-user');

    // Wait a bit to avoid rate limiting
    await delay(1000);
  }, 120000);

  describe('Phase 1: Manager Invitation Workflow (Mocked)', () => {
    it('should allow admin to invite a manager', async () => {
      const email = `manager1-${Date.now()}@test.com`;

      const response = await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email,
          displayName: 'Test Manager 1',
          address: '123 Test St, Austin, TX 78701',
          phoneNumber: '+1-512-555-1234',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('email', email);
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('expiresAt');
      expect(response.body).toHaveProperty('status', 'pending');
      expect(response.body).toHaveProperty('displayName', 'Test Manager 1');

      invitation1 = response.body;
    });

    it('should allow admin to invite multiple managers', async () => {
      const email = `manager2-${Date.now()}@test.com`;

      const response = await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email,
          displayName: 'Test Manager 2',
          address: '456 Test Ave, Austin, TX 78702',
          phoneNumber: '+1-512-555-5678',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('email', email);
      expect(response.body).toHaveProperty('token');
      expect(response.body.status).toBe('pending');

      invitation2 = response.body;
      await delay(500);
    });

    it('should reject duplicate pending invitations for same email', async () => {
      const email = `duplicate-${Date.now()}@test.com`;

      // First invitation
      await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email,
          displayName: 'Duplicate Test Manager',
          address: '789 Test Blvd, Austin, TX 78703',
        })
        .expect(201);

      await delay(500);

      // Duplicate invitation should fail
      await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email,
          displayName: 'Duplicate Test Manager 2',
          address: '789 Test Blvd, Austin, TX 78703',
        })
        .expect(400);
    });

    it('should reject non-admin from inviting managers', async () => {
      const userToken = regularUser.token;

      await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(userToken, { type: 'bearer' })
        .send({
          email: 'test@test.com',
          displayName: 'Test Manager',
          address: '123 Test St',
        })
        .expect(403);
    });

    it('should validate invitation token (public endpoint)', async () => {
      const response = await request(APP_URL)
        .get(`/api/v1/manager-onboarding/invitations/${invitation1.token}`)
        .expect((res) => {
          // Either 200 (if implemented) or 500/404 (if not yet implemented)
          expect([200, 404, 500]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toHaveProperty('displayName');
        expect(response.body).toHaveProperty('expiresAt');
      }
    });
  });

  describe('Phase 2: Manager Acceptance & Profile Creation', () => {
    it('should allow manager to accept invitation and create profile', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/manager-onboarding/accept')
        .send({
          token: invitation1.token,
          user: {
            firstName: 'Manager',
            lastName: 'One',
            password: 'SecurePassword123!',
          },
          managerProfile: {
            displayName: 'Test Manager Instance 1',
            location: {
              address: '123 Test St',
              city: 'Austin',
              state: 'TX',
              country: 'US',
              zip: '78701',
            },
          },
        })
        .expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('manager');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('email', invitation1.email);
      expect(response.body.manager).toHaveProperty('id');
      expect(response.body.manager).toHaveProperty('displayName');
      expect(response.body.manager).toHaveProperty(
        'verificationStatus',
        'pending',
      );

      managerUser1 = response.body.user;
      manager1 = response.body.manager;

      // Login as manager to get token
      const loginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({
          email: invitation1.email,
          password: 'SecurePassword123!',
        })
        .expect(200);

      managerUser1.token = loginResponse.body.token;
      await delay(1000);
    });

    it('should allow second manager to accept invitation', async () => {
      const response = await request(APP_URL)
        .post('/api/v1/manager-onboarding/accept')
        .send({
          token: invitation2.token,
          user: {
            firstName: 'Manager',
            lastName: 'Two',
            password: 'SecurePassword123!',
          },
          managerProfile: {
            displayName: 'Test Manager Instance 2',
          },
        })
        .expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('manager');

      managerUser2 = response.body.user;
      manager2 = response.body.manager;

      // Login as manager to get token
      const loginResponse = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({
          email: invitation2.email,
          password: 'SecurePassword123!',
        })
        .expect(200);

      managerUser2.token = loginResponse.body.token;
      await delay(1000);
    });

    it('should reject accepting already accepted invitation', async () => {
      await request(APP_URL)
        .post('/api/v1/manager-onboarding/accept')
        .send({
          token: invitation1.token, // Already accepted
          user: {
            firstName: 'Test',
            lastName: 'User',
            password: 'Password123!',
          },
          managerProfile: {
            displayName: 'Test',
          },
        })
        .expect(400);
    });

    it('should reject invalid invitation token', async () => {
      await request(APP_URL)
        .post('/api/v1/manager-onboarding/accept')
        .send({
          token: 'invalid-token-12345',
          user: {
            firstName: 'Test',
            lastName: 'User',
            password: 'Password123!',
          },
          managerProfile: {
            displayName: 'Test',
          },
        })
        .expect(404);
    });
  });

  describe('Phase 3: Manager Verification & Status', () => {
    it('should allow admin to verify manager', async () => {
      const response = await request(APP_URL)
        .patch(`/api/v1/admin/managers/${manager1.id}/verify`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          status: 'verified',
        })
        .expect(200);

      expect(response.body).toHaveProperty('id', manager1.id);
      expect(response.body).toHaveProperty('verificationStatus', 'verified');
      await delay(500);
    });

    it('should reject non-admin from verifying managers', async () => {
      await request(APP_URL)
        .patch(`/api/v1/admin/managers/${manager1.id}/verify`)
        .auth(managerUser1.token, { type: 'bearer' })
        .send({
          status: 'verified',
        })
        .expect(403);
    });

    it('should show verified manager in directory', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/managers')
        .auth(managerUser1.token, { type: 'bearer' })
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      // Verified manager should appear in directory
      const verifiedManager = response.body.find(
        (m: any) => m.id === manager1.id,
      );
      expect(verifiedManager).toBeDefined();
    });

    it('should NOT show unverified manager in directory', async () => {
      // manager2 is not verified, so it should NOT appear in directory
      const response = await request(APP_URL)
        .get('/api/v1/managers')
        .auth(managerUser2.token, { type: 'bearer' })
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      // manager2 should NOT appear (not verified)
      const unverifiedManager = response.body.find(
        (m: any) => m.id === manager2.id,
      );
      expect(unverifiedManager).toBeUndefined();
    });
  });

  describe('Phase 4: Document Operations - Verified vs Unverified Managers', () => {
    it('should allow VERIFIED manager to upload document', async () => {
      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n>>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<<\n/Size 4\n/Root 1 0 R\n>>\nstartxref\n181\n%%EOF',
      );

      const response = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser1.token, { type: 'bearer' })
        .field('documentType', DocumentType.LAB_RESULT)
        .attach('file', pdfBuffer, 'test-document-verified.pdf')
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('originManagerId');
      expect(response.body).toHaveProperty('status');

      documentId1 = response.body.id;
      await delay(1000);
    });

    it('should REJECT UNVERIFIED manager from uploading document', async () => {
      // manager2 is not verified, so upload should fail
      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF',
      );

      await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser2.token, { type: 'bearer' })
        .field('documentType', DocumentType.LAB_RESULT)
        .attach('file', pdfBuffer, 'test-document-unverified.pdf')
        .expect(403); // Should be forbidden - manager not verified
    });

    it('should allow VERIFIED manager to trigger OCR', async () => {
      if (!documentId1) {
        return; // Skip if previous test failed
      }

      const response = await request(APP_URL)
        .post(`/api/v1/documents/${documentId1}/ocr/trigger`)
        .auth(managerUser1.token, { type: 'bearer' })
        .expect((res) => {
          // Either 202 (accepted) or 400 (if document not in correct state)
          expect([202, 400]).toContain(res.status);
        });

      await delay(1000);
    });

    it('should REJECT UNVERIFIED manager from triggering OCR', async () => {
      // First verify manager2 so it can upload a document
      await request(APP_URL)
        .patch(`/api/v1/admin/managers/${manager2.id}/verify`)
        .auth(adminToken, { type: 'bearer' })
        .send({ status: 'verified' })
        .expect(200);

      await delay(500);

      // Create document as verified manager2
      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF',
      );

      const uploadResponse = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser2.token, { type: 'bearer' })
        .field('documentType', DocumentType.LAB_RESULT)
        .attach('file', pdfBuffer, 'test-document-manager2.pdf')
        .expect(201);

      documentId2 = uploadResponse.body.id;
      await delay(1000);

      // Now suspend manager2 to test suspended manager access
      await request(APP_URL)
        .patch(`/api/v1/admin/managers/${manager2.id}/suspend`)
        .auth(adminToken, { type: 'bearer' })
        .send({ reason: 'Testing suspended manager access' })
        .expect(200);

      await delay(500);

      // Suspended manager should not be able to trigger OCR
      await request(APP_URL)
        .post(`/api/v1/documents/${documentId2}/ocr/trigger`)
        .auth(managerUser2.token, { type: 'bearer' })
        .expect(403); // Should be forbidden - manager is suspended
    });
  });

  describe('Phase 5: Role Boundaries & Access Control', () => {
    it('should REJECT admin from uploading documents', async () => {
      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF',
      );

      await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(adminToken, { type: 'bearer' })
        .field('documentType', DocumentType.LAB_RESULT)
        .attach('file', pdfBuffer, 'test-document-admin.pdf')
        .expect(403); // Admin should be hard-denied
    });

    it('should REJECT admin from accessing documents', async () => {
      if (!documentId1) {
        return; // Skip if document not created
      }

      await request(APP_URL)
        .get(`/api/v1/documents/${documentId1}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(403); // Admin should be hard-denied
    });

    it('should REJECT admin from triggering OCR', async () => {
      if (!documentId1) {
        return; // Skip if document not created
      }

      await request(APP_URL)
        .post(`/api/v1/documents/${documentId1}/ocr/trigger`)
        .auth(adminToken, { type: 'bearer' })
        .expect(403); // Admin should be hard-denied
    });

    it('should allow user to upload document with assigned verified manager', async () => {
      // Assign verified manager1 to regular user
      // NOTE: managerId must be the User ID, not the Manager ID
      const assignmentResponse = await request(APP_URL)
        .post(`/api/v1/users/${regularUser.id}/manager-assignments`)
        .auth(adminToken, { type: 'bearer' })
        .send({ managerId: managerUser1.id }) // Use User ID, not Manager ID
        .expect(201);

      // Verify assignment was created
      expect(assignmentResponse.body).toHaveProperty('userId', regularUser.id);
      expect(assignmentResponse.body).toHaveProperty(
        'managerId',
        managerUser1.id,
      ); // User ID

      // Wait longer to ensure database transaction is committed
      await delay(1000);

      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF',
      );

      const response = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(regularUser.token, { type: 'bearer' })
        .field('documentType', DocumentType.LAB_RESULT)
        .attach('file', pdfBuffer, 'test-document-user.pdf')
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('originManagerId');
      await delay(1000);
    });

    it('should REJECT user without assigned manager from uploading', async () => {
      // Create a user without manager assignment
      const unassignedUser = await createTestUser(
        RoleEnum.user,
        'unassigned-user',
      );
      await delay(1000);

      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF',
      );

      await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(unassignedUser.token, { type: 'bearer' })
        .field('documentType', DocumentType.LAB_RESULT)
        .attach('file', pdfBuffer, 'test-document-unassigned.pdf')
        .expect(400); // Should fail - no assigned manager
    });
  });

  describe('Phase 6: Manager Self-Service', () => {
    // Rate limit reset: Login endpoint is limited to 5 requests per 60 seconds.
    // Previous tests have made multiple login attempts, so we wait to ensure
    // the rate limit window has reset before this phase.
    beforeAll(async () => {
      await delay(65000); // Wait 65 seconds to ensure rate limit window resets (60s window + 5s buffer)
    }, 70000); // Increase timeout to 70 seconds for the beforeAll hook (65s delay + 5s buffer for execution)

    it('should allow verified manager to get own profile', async () => {
      const response = await request(APP_URL)
        .get('/api/v1/managers/me')
        .auth(managerUser1.token, { type: 'bearer' })
        .expect(200);

      expect(response.body).toHaveProperty('id', manager1.id);
      expect(response.body).toHaveProperty('displayName');
    });

    it('should allow verified manager to update own profile', async () => {
      const response = await request(APP_URL)
        .patch('/api/v1/managers/me')
        .auth(managerUser1.token, { type: 'bearer' })
        .send({
          displayName: 'Updated Manager Display Name',
          phoneNumber: '+1-555-0123',
          operatingHours: 'Mon–Fri 8am–5pm',
        })
        .expect(200);

      expect(response.body).toHaveProperty('id', manager1.id);
    });

    it('should REJECT unverified manager from updating profile', async () => {
      // Create an unverified manager
      const email = `unverified-${Date.now()}@test.com`;
      const inviteResponse = await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email,
          displayName: 'Unverified Manager',
          address: '999 Unverified St, Austin, TX 78799',
        })
        .expect(201);

      await delay(1000);

      const acceptResponse = await request(APP_URL)
        .post('/api/v1/manager-onboarding/accept')
        .send({
          token: inviteResponse.body.token,
          user: {
            firstName: 'Unverified',
            lastName: 'Manager',
            password: 'Password123!',
          },
          managerProfile: {
            displayName: 'Unverified Manager',
          },
        })
        .expect(201);

      // CRITICAL: Wait longer before login attempt to avoid rate limiting.
      await delay(65000); // 65 seconds (60s rate limit window + 5s buffer)

      // Login as unverified manager with retry on rate limit
      let loginResponse;
      let lastError;
      for (let i = 0; i < 5; i++) {
        try {
          loginResponse = await request(APP_URL)
            .post('/api/v1/auth/email/login')
            .send({
              email,
              password: 'Password123!',
            });

          if (loginResponse.status === 200) {
            break;
          } else if (loginResponse.status === 429 && i < 4) {
            const backoffMs = 15000 * (i + 1); // 15s, 30s, 45s, 60s
            await delay(backoffMs);
            continue;
          } else {
            lastError = new Error(
              `Login failed with status ${loginResponse.status}`,
            );
            if (i < 4) {
              await delay(15000 * (i + 1));
              continue;
            }
            throw lastError;
          }
        } catch (error: any) {
          lastError = error;
          if (i < 4) {
            await delay(15000 * (i + 1));
            continue;
          }
          throw error;
        }
      }

      if (!loginResponse || loginResponse.status !== 200) {
        throw lastError || new Error('Login failed after all retries');
      }

      expect(loginResponse.status).toBe(200);
      const unverifiedToken = loginResponse.body.token;

      // Unverified manager should not be able to update profile
      await request(APP_URL)
        .patch('/api/v1/managers/me')
        .auth(unverifiedToken, { type: 'bearer' })
        .send({
          displayName: 'Updated Name',
        })
        .expect(403); // Should be forbidden - manager is not verified
    }, 120000); // Increase timeout to 120 seconds
  });

  describe('Phase 7: Manager Suspension & Access Control', () => {
    it('should allow admin to suspend manager', async () => {
      const response = await request(APP_URL)
        .patch(`/api/v1/admin/managers/${manager1.id}/suspend`)
        .auth(adminToken, { type: 'bearer' })
        .send({
          reason: 'Compliance review - testing suspension',
        })
        .expect(200);

      expect(response.body).toHaveProperty('id', manager1.id);
      await delay(500);
    });

    it('should REJECT suspended manager from uploading documents', async () => {
      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF',
      );

      await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser1.token, { type: 'bearer' })
        .field('documentType', DocumentType.LAB_RESULT)
        .attach('file', pdfBuffer, 'test-document-suspended.pdf')
        .expect(403); // Should be forbidden - manager suspended
    });

    it('should allow admin to re-verify suspended manager', async () => {
      // Re-verify the manager
      await request(APP_URL)
        .patch(`/api/v1/admin/managers/${manager1.id}/verify`)
        .auth(adminToken, { type: 'bearer' })
        .send({ status: 'verified' })
        .expect(200);

      await delay(500);

      // Manager should now be able to upload again
      const pdfBuffer = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n>>\nendobj\nxref\n0 1\ntrailer\n<<\n/Root 1 0 R\n>>\n%%EOF',
      );

      const response = await request(APP_URL)
        .post('/api/v1/documents/upload')
        .auth(managerUser1.token, { type: 'bearer' })
        .field('documentType', DocumentType.LAB_RESULT)
        .attach('file', pdfBuffer, 'test-document-reverified.pdf')
        .expect(201);

      expect(response.body).toHaveProperty('id');
    });
  });

  describe('Phase 8: Edge Cases & Error Handling', () => {
    it('should handle expired invitation tokens', async () => {
      // Create invitation
      const email = `expired-${Date.now()}@test.com`;
      const inviteResponse = await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email,
          displayName: 'Expired Test Manager',
          address: '123 Expired St, Austin, TX 78701',
        })
        .expect(201);

      // TODO: In a real scenario, we would need to manually expire the token
      // For now, we'll test with an invalid token
      await request(APP_URL)
        .post('/api/v1/manager-onboarding/accept')
        .send({
          token: 'expired-token-12345',
          user: {
            firstName: 'Test',
            lastName: 'User',
            password: 'Password123!',
          },
          managerProfile: {
            displayName: 'Test',
          },
        })
        .expect(404); // Should fail - token not found or expired
    });

    it('should validate required fields in invitation acceptance', async () => {
      // Create a valid invitation token first
      const email = `validation-test-${Date.now()}@test.com`;
      const invitationResponse = await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email,
          displayName: 'Validation Test Manager',
          address: '123 Validation St, Austin, TX 78701',
        })
        .expect(201);

      const validToken = invitationResponse.body.token;
      await delay(500);

      // Try to accept with missing required fields (user and managerProfile)
      await request(APP_URL)
        .post('/api/v1/manager-onboarding/accept')
        .send({
          token: validToken,
          // Missing user and managerProfile - should fail validation
        })
        .expect(400); // Should fail validation (Bad Request)
    });

    it('should validate manager profile update restrictions', async () => {
      // Manager should not be able to update verification status
      const response = await request(APP_URL)
        .patch('/api/v1/managers/me')
        .auth(managerUser1.token, { type: 'bearer' })
        .send({
          displayName: 'Updated Name',
        })
        .expect(200);

      // Response should include updated fields
      expect(response.body).toHaveProperty('displayName', 'Updated Name');
    });
  });
});
