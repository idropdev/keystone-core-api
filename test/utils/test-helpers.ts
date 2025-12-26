import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { APP_URL, ADMIN_EMAIL, ADMIN_PASSWORD } from './constants';
import { RoleEnum } from '../../src/roles/roles.enum';
import { StatusEnum } from '../../src/statuses/statuses.enum';

export interface TestUser {
  id: number;
  email: string;
  token: string;
  roleId: RoleEnum;
}

export interface TestManager {
  id: number;
  userId: number;
  token: string;
}

export interface TestManagerInvitation {
  id: number;
  email: string;
  displayName: string;
  token: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

/**
 * Sleep utility to avoid rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a request with exponential backoff on rate limit
 */
async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000,
  operation = 'operation',
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await fn();
      if (i > 0) {
        console.log(`[RETRY] ${operation} succeeded on attempt ${i + 1}`);
      }
      return result;
    } catch (error: any) {
      const isRateLimit = error.status === 429 || (error.response && error.response.status === 429);
      
      if (isRateLimit && i < maxRetries - 1) {
        // Rate limited - wait and retry with exponential backoff
        const waitTime = delayMs * Math.pow(2, i); // Exponential backoff
        console.log(`[RETRY] ${operation} rate limited (429), waiting ${waitTime}ms before retry ${i + 2}/${maxRetries}`);
        await sleep(waitTime);
        continue;
      }
      
      // Log non-rate-limit errors
      if (!isRateLimit) {
        console.error(`[RETRY] ${operation} failed (non-rate-limit):`, error.message || error);
      }
      
      throw error;
    }
  }
  throw new Error(`Max retries (${maxRetries}) exceeded for ${operation}`);
}

/**
 * Create a test user with the specified role
 */
export async function createTestUser(
  roleId: RoleEnum = RoleEnum.user,
  emailPrefix = 'test',
): Promise<TestUser> {
  const email = `${emailPrefix}.${Date.now()}.${Math.random().toString(36).substring(7)}@example.com`;
  const password = 'secret';

  console.log(`[CREATE_USER] Starting user creation: ${emailPrefix} (${email})`);
  
  // Register user with retry on rate limit (reduced retries and delays for faster execution)
  const registerResponse = await retryOnRateLimit(
    async () => {
      const response = await request(APP_URL)
        .post('/api/v1/auth/email/register')
        .timeout(10000) // 10 second timeout per request
        .send({
          email,
          password,
          firstName: `Test${Date.now()}`,
          lastName: 'User',
        });

      if (response.status === 429) {
        throw { status: 429 };
      }
      if (response.status >= 400 && response.status < 500) {
        // Don't retry on client errors (except rate limit)
        throw new Error(
          `Registration failed: ${response.status} - ${JSON.stringify(response.body)}`,
        );
      }
      console.log(`[CREATE_USER] Registration successful for ${emailPrefix}: ${response.status}`);
      return response;
    },
    5, // max retries (increased back to 5 for rate limit resilience)
    3000, // initial delay 3 seconds
    `register user ${emailPrefix}`,
  );

  // Wait a bit before login to avoid rate limiting
  console.log(`[CREATE_USER] Waiting 2s before login for ${emailPrefix}`);
  await sleep(2000);

  // Login to get token with retry on rate limit
  const loginResponse = await retryOnRateLimit(
    async () => {
      const response = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .timeout(10000) // 10 second timeout per request
        .send({ email, password });

      if (response.status === 429) {
        throw { status: 429 };
      }
      if (response.status !== 200) {
        throw new Error(
          `Login failed: ${response.status} - ${JSON.stringify(response.body)}`,
        );
      }
      console.log(`[CREATE_USER] Login successful for ${emailPrefix}`);
      return response;
    },
    5, // max retries (increased back to 5 for rate limit resilience)
    3000, // initial delay 3 seconds
    `login user ${emailPrefix}`,
  );

  // If role is not user, admin needs to update it
  if (roleId !== RoleEnum.user) {
    const adminToken = await getAdminToken();
    const user = loginResponse.body.user;

    await retryOnRateLimit(
      async () => {
        const response = await request(APP_URL)
          .patch(`/api/v1/users/${user.id}`)
          .timeout(10000) // 10 second timeout per request
          .auth(adminToken, { type: 'bearer' })
          .send({
            role: { id: roleId },
          });

        if (response.status === 429) {
          throw { status: 429 };
        }
        if (response.status !== 200) {
          throw new Error(
            `User update failed: ${response.status} - ${JSON.stringify(response.body)}`,
          );
        }
        console.log(`[CREATE_USER] Role update successful for ${emailPrefix}`);
        return response;
      },
      5, // max retries
      3000, // initial delay 3 seconds
      `update role for ${emailPrefix}`,
    );

    // Wait before re-login
    await sleep(2000);

    // Re-login to get updated token
    const updatedLoginResponse = await retryOnRateLimit(
      async () => {
        const response = await request(APP_URL)
          .post('/api/v1/auth/email/login')
          .timeout(10000) // 10 second timeout per request
          .send({ email, password });

        if (response.status === 429) {
          throw { status: 429 };
        }
        if (response.status !== 200) {
          throw new Error(
            `Re-login failed: ${response.status} - ${JSON.stringify(response.body)}`,
          );
        }
        console.log(`[CREATE_USER] Re-login successful for ${emailPrefix}`);
        return response;
      },
      5, // max retries
      3000, // initial delay 3 seconds
      `re-login user ${emailPrefix}`,
    );

    return {
      id: user.id,
      email,
      token: updatedLoginResponse.body.token,
      roleId,
    };
  }

  const result = {
    id: loginResponse.body.user.id,
    email,
    token: loginResponse.body.token,
    roleId,
  };
  
  console.log(`[CREATE_USER] User creation completed for ${emailPrefix}: userId=${result.id}`);
  return result;
}

/**
 * Get admin token
 */
export async function getAdminToken(): Promise<string> {
  const response = await retryOnRateLimit(
    async () => {
      const response = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .timeout(10000) // 10 second timeout per request
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      if (response.status === 429) {
        throw { status: 429 };
      }
      if (response.status !== 200) {
        throw new Error(
          `Admin login failed: ${response.status} - ${JSON.stringify(response.body)}`,
        );
      }
      return response;
    },
    5, // max retries
    3000, // initial delay 3 seconds
    'get admin token',
  );

  return response.body.token;
}

/**
 * Create a test manager (requires admin token)
 * Creates a Manager for the manager user
 * 
 * NOTE: This attempts to create via API endpoints. If endpoints don't exist,
 * it will throw an error indicating they need to be implemented.
 */
export async function createTestManager(
  adminToken: string,
): Promise<TestManager> {
  // Create manager invitation with identity fields
  const email = `manager-${Date.now()}@test.com`;
  const displayName = `Test Manager ${Date.now()}`;
  const invitation = await createTestManagerInvitation(
    adminToken,
    email,
    {
      displayName,
      address: '123 Test St, Austin, TX 78701',
      phoneNumber: '+1-512-555-1234',
    },
  );

  // Accept invitation to create manager user and manager
  const password = 'TestPassword123!';
  const { user, manager, token } = await acceptTestManagerInvitation(
    invitation.token,
    {
      firstName: 'Test',
      lastName: 'Manager',
      password,
    },
    {
      displayName,
    },
  );

  // Verify the manager (required for document operations)
  await verifyTestManager(adminToken, manager.id);

  return {
    id: manager.id, // Manager ID (not User ID)
    userId: user.id,
    token: token, // Token from accepted invitation/login
  };
}

/**
 * Get the test PDF file path (lab-result.pdf)
 */
export function getTestPdfPath(): string {
  // Path relative to project root: docs/test_docs/lab-result.pdf
  // __dirname in test context points to the compiled location or source location depending on setup
  // Use process.cwd() to get project root for more reliable path resolution
  const projectRoot = process.cwd();
  return path.join(projectRoot, 'docs', 'test_docs', 'lab-result.pdf');
}

/**
 * Read a PDF file from the filesystem
 */
export function readPdfFile(filePath: string): Buffer {
  try {
    return fs.readFileSync(filePath);
  } catch (error: any) {
    throw new Error(`Failed to read PDF file at ${filePath}: ${error.message}`);
  }
}

/**
 * Upload a test document
 * Note: originManagerId is determined automatically from the actor (manager or user's assigned manager)
 * 
 * @param token - JWT token for authentication
 * @param originManagerId - Manager instance ID (not used in request, but kept for reference)
 * @param documentType - Type of document (default: 'LAB_RESULT')
 * @param pdfFilePath - Optional path to PDF file. If not provided, uses lab-result.pdf from docs/test_docs/
 * @param fileName - Optional custom filename. If not provided, uses the filename from pdfFilePath or 'test-document.pdf'
 */
export async function uploadTestDocument(
  token: string,
  originManagerId: number, // Not used in request, but kept for reference
  documentType = 'LAB_RESULT',
  pdfFilePath?: string,
  fileName?: string,
): Promise<{ documentId: string }> {
  let pdfBuffer: Buffer;
  let finalFileName: string;

  if (pdfFilePath) {
    // Use provided PDF file path
    pdfBuffer = readPdfFile(pdfFilePath);
    finalFileName = fileName || path.basename(pdfFilePath);
  } else {
    // Try to use the test PDF file (lab-result.pdf) if it exists
    const testPdfPath = getTestPdfPath();
    try {
      pdfBuffer = readPdfFile(testPdfPath);
      finalFileName = fileName || 'lab-result.pdf';
    } catch (error) {
      // Fallback to generated minimal PDF if test file doesn't exist
      pdfBuffer = Buffer.from(
        '%PDF-1.4\n' +
        '1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n' +
        '2 0 obj\n<<\n/Type /Pages\n/Kids [3 0 R]\n/Count 1\n>>\nendobj\n' +
        '3 0 obj\n<<\n/Type /Page\n/Parent 2 0 R\n/MediaBox [0 0 612 792]\n>>\nendobj\n' +
        'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n' +
        'trailer\n<<\n/Size 4\n/Root 1 0 R\n>>\n' +
        'startxref\n181\n%%EOF',
      );
      finalFileName = fileName || 'test-document.pdf';
    }
  }

  const response = await request(APP_URL)
    .post('/api/v1/documents/upload')
    .auth(token, { type: 'bearer' })
    .field('documentType', documentType)
    .attach('file', pdfBuffer, finalFileName);

  if (response.status !== 201) {
    throw new Error(
      `Document upload failed: ${response.status} - ${JSON.stringify(response.body)}`,
    );
  }

  return { documentId: response.body.id };
}

/**
 * Create a manager invitation (mocked - no email sent)
 * This mocks the invitation workflow for testing
 */
export async function createTestManagerInvitation(
  adminToken: string,
  email: string,
  managerIdentity: {
    displayName: string;
    legalName?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
    phoneNumber?: string;
  },
): Promise<TestManagerInvitation> {
  const response = await retryOnRateLimit(
    async () => {
      const res = await request(APP_URL)
        .post('/api/v1/admin/manager-invitations')
        .auth(adminToken, { type: 'bearer' })
        .send({
          email,
          displayName: managerIdentity.displayName,
          legalName: managerIdentity.legalName,
          address: managerIdentity.address,
          latitude: managerIdentity.latitude,
          longitude: managerIdentity.longitude,
          phoneNumber: managerIdentity.phoneNumber,
        });

      if (res.status === 429) {
        throw { status: 429 };
      }
      if (res.status !== 201) {
        throw new Error(
          `Invitation creation failed: ${res.status} - ${JSON.stringify(res.body)}`,
        );
      }
      return res;
    },
    3,
    2000,
  );

  await sleep(500);
  return response.body;
}

/**
 * Accept a manager invitation and create manager profile
 */
export async function acceptTestManagerInvitation(
  token: string,
  userData: {
    firstName: string;
    lastName: string;
    password: string;
  },
  managerProfile?: {
    displayName?: string;
    location?: any;
    identifiers?: any;
  },
): Promise<{ user: any; manager: any; token: string }> {
  const response = await retryOnRateLimit(
    async () => {
      const res = await request(APP_URL)
        .post('/api/v1/manager-onboarding/accept')
        .send({
          token,
          user: userData,
          managerProfile: managerProfile || {
            displayName: `Test Manager ${Date.now()}`,
          },
        });

      if (res.status === 429) {
        throw { status: 429 };
      }
      if (res.status !== 201) {
        throw new Error(
          `Invitation acceptance failed: ${res.status} - ${JSON.stringify(res.body)}`,
        );
      }
      return res;
    },
    3,
    2000,
  );

  await sleep(1000);

  // Login as the new manager to get token
  const loginResponse = await retryOnRateLimit(
    async () => {
      const res = await request(APP_URL)
        .post('/api/v1/auth/email/login')
        .send({
          email: response.body.user.email,
          password: userData.password,
        });

      if (res.status === 429) {
        throw { status: 429 };
      }
      if (res.status !== 200) {
        throw new Error(
          `Manager login failed: ${res.status} - ${JSON.stringify(res.body)}`,
        );
      }
      return res;
    },
    3,
    2000,
  );

  return {
    user: response.body.user,
    manager: response.body.manager,
    token: loginResponse.body.token,
  };
}

/**
 * Verify a manager (admin only)
 */
export async function verifyTestManager(
  adminToken: string,
  managerId: number,
): Promise<any> {
  const response = await retryOnRateLimit(
    async () => {
      const res = await request(APP_URL)
        .patch(`/api/v1/admin/managers/${managerId}/verify`)
        .auth(adminToken, { type: 'bearer' })
        .send({ status: 'verified' });

      if (res.status === 429) {
        throw { status: 429 };
      }
      if (res.status !== 200) {
        throw new Error(
          `Manager verification failed: ${res.status} - ${JSON.stringify(res.body)}`,
        );
      }
      return res;
    },
    3,
    2000,
  );

  await sleep(500);
  return response.body;
}

/**
 * Get user info from token (for extracting actor info)
 */
async function getUserInfoFromToken(token: string): Promise<{ id: number; roleId: RoleEnum }> {
  const response = await request(APP_URL)
    .get('/api/v1/auth/me')
    .auth(token, { type: 'bearer' });

  if (response.status !== 200) {
    throw new Error(`Failed to get user info: ${response.status} - ${JSON.stringify(response.body)}`);
  }

  const roleId = response.body.role?.id || response.body.roleId;
  if (!roleId) {
    throw new Error(`Role ID not found in user info: ${JSON.stringify(response.body)}`);
  }

  return {
    id: Number(response.body.id),
    roleId: Number(roleId),
  };
}

/**
 * Create an access grant
 * Note: Current implementation uses flat structure /v1/access-grants with documentId in body
 * Phase 3 plan specifies nested path /v1/documents/:id/access-grants (future migration)
 */
export async function createAccessGrant(
  token: string,
  documentId: string,
  subjectType: 'user' | 'manager',
  subjectId: number,
  grantType: 'delegated' | 'derived' = 'delegated',
): Promise<{ grantId: number }> {
  console.log(`[CREATE_ACCESS_GRANT] Creating grant: documentId=${documentId}, subjectType=${subjectType}, subjectId=${subjectId}, grantType=${grantType}`);
  
  // Get actor info from token to populate grantedByType and grantedById
  const userInfo = await getUserInfoFromToken(token);
  console.log(`[CREATE_ACCESS_GRANT] User info: id=${userInfo.id}, roleId=${userInfo.roleId}`);
  
  // Determine grantedByType from role
  let grantedByType: 'user' | 'manager';
  if (userInfo.roleId === RoleEnum.manager) {
    grantedByType = 'manager';
  } else {
    grantedByType = 'user';
  }

  // Current implementation: POST /v1/access-grants (flat structure)
  // TODO: Migrate to nested path: POST /v1/documents/:id/access-grants
  const response = await request(APP_URL)
    .post('/api/v1/access-grants')
    .timeout(10000)
    .auth(token, { type: 'bearer' })
    .send({
      documentId,
      subjectType,
      subjectId,
      grantType,
      grantedByType,
      grantedById: userInfo.id,
    });

  console.log(`[CREATE_ACCESS_GRANT] Response: status=${response.status}, body=${JSON.stringify(response.body)}`);

  if (response.status === 400 && response.body?.message?.includes('already exists')) {
    // Grant already exists - this is OK, try to find the existing grant
    console.log(`[CREATE_ACCESS_GRANT] Grant already exists, this is OK`);
    // Return a mock grantId - the grant exists so access should work
    return { grantId: -1 }; // Special value indicating grant exists
  }

  if (response.status !== 201) {
    throw new Error(
      `Failed to create access grant: ${response.status} - ${JSON.stringify(response.body)}`,
    );
  }

  console.log(`[CREATE_ACCESS_GRANT] Grant created successfully: grantId=${response.body.id}`);
  
  // Small delay to ensure grant is committed to database
  await sleep(500);
  
  return { grantId: response.body.id };
}

