import nock from 'nock';
import { MockAgent } from 'undici';
import * as jwt from 'jsonwebtoken';

import { ANYTHINGLLM_BASE_URL } from './constants';
import {
  startMockServer,
  setMockResponse,
  isMockCalled,
  clearMocks,
  // getServerPort,
  getMockResponse,
} from './mock-anythingllm-server';

// CRITICAL: For Node.js 18+ with native fetch, nock doesn't intercept by default
// We need to enable undici mocking for nock to work with native fetch
if (
  typeof process !== 'undefined' &&
  process.versions &&
  parseInt(process.versions.node.split('.')[0]) >= 18
) {
  // Enable nock for undici (which native fetch uses in Node 18+)
  // This is done automatically by nock if undici is available
  // But we need to ensure nock is active
  if (!nock.isActive()) {
    nock.activate();
  }
}

/**
 * Admin context for delegated tokens when no user context is available
 */
export const ADMIN_CONTEXT = {
  userId: '1', // System admin ID
  roles: ['admin'],
};

/**
 * Verify that a JWT token uses HS256 algorithm (delegated token)
 * Throws error if token is RS256 or invalid
 *
 * @param token - JWT token to verify
 * @returns true if token is HS256, throws error otherwise
 */
export function verifyHS256Token(token: string): boolean {
  try {
    const decoded = jwt.decode(token, { complete: true }) as any;

    if (!decoded || !decoded.header) {
      throw new Error('Invalid token: missing header');
    }

    if (decoded.header.alg !== 'HS256') {
      throw new Error(
        `CRITICAL: Token uses algorithm ${decoded.header.alg} but MUST be HS256. Delegated tokens must use HS256, not RS256.`,
      );
    }

    return true;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to verify token algorithm');
  }
}

/**
 * Extract and verify Authorization header contains HS256 token
 *
 * @param headers - Request headers
 * @returns true if Authorization header contains valid HS256 token
 * @throws Error if token is missing, invalid, or not HS256
 */
export function verifyAuthorizationHeader(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const authHeader =
    headers.authorization || headers.Authorization || headers['Authorization'];

  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  const authValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

  if (!authValue.startsWith('Bearer ')) {
    throw new Error('Authorization header must start with "Bearer "');
  }

  const token = authValue.substring(7); // Remove "Bearer " prefix
  return verifyHS256Token(token);
}

/**
 * Setup nock interceptor for AnythingLLM endpoint with HS256 token validation
 *
 * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param endpoint - API endpoint path (e.g., '/v1/admin/users/new')
 * @param statusCode - HTTP status code to return
 * @param responseBody - Response body to return
 * @param validateToken - Whether to validate token is HS256 (default: true)
 * @returns nock scope
 */
// Get the undici MockAgent from global scope (set in setup-e2e.ts)
function _getMockAgent(): MockAgent {
  const mockAgent = (globalThis as any).__undiciMockAgent;
  if (!mockAgent) {
    throw new Error(
      'undici MockAgent not found. Make sure setup-e2e.ts is loaded.',
    );
  }
  return mockAgent;
}

export function setupAnythingLLMMock(
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
  endpoint: string,
  statusCode: number,
  responseBody: any,
  validateToken: boolean = true,
): { isDone: () => boolean; pendingMocks: () => string[] } {
  const baseUrl = ANYTHINGLLM_BASE_URL;

  // CRITICAL: For E2E tests, we use a mock HTTP server instead of nock or undici MockAgent
  // Nock cannot intercept native fetch() in Node.js 18+ (uses undici)
  // Undici MockAgent in test setup can't intercept requests from the running NestJS app
  // (they're in separate processes)
  // Solution: Use a real HTTP mock server on localhost:3002 that native fetch can connect to

  // Ensure mock server is running
  // Use port 3002 for mock server to avoid collision with real AnythingLLM on 3001
  const mockServerPort = 3002; // Always use 3002 for mock server

  // Start mock server if not already running
  startMockServer(mockServerPort).catch(() => {
    // Ignore errors
  });

  // Set mock response in the server
  // endpoint is like "/v1/workspace/new", we need to use it as-is
  setMockResponse(
    method,
    endpoint,
    statusCode,
    responseBody,
    validateToken,
    undefined,
    undefined,
    undefined,
  );

  // Return a mock object that matches nock's interface for compatibility
  const mockKey = `${method.toUpperCase()} ${baseUrl}${endpoint}`;
  return {
    isDone: () => isMockCalled(method, endpoint),
    pendingMocks: () => (isMockCalled(method, endpoint) ? [] : [mockKey]),
  };
}

/**
 * Setup mock that fails on first N attempts, then succeeds
 * Useful for testing retry logic
 * Uses mock HTTP server for E2E tests (works with native fetch)
 *
 * @param method - HTTP method
 * @param endpoint - API endpoint path
 * @param failCount - Number of times to fail before succeeding
 * @param successStatusCode - HTTP status code for success response
 * @param successBody - Response body for success
 * @param failStatusCode - HTTP status code for failure response (default: 500)
 * @param failBody - Response body for failure (default: { error: 'Internal Server Error' })
 * @param validateToken - Whether to validate token is HS256 (default: true)
 * @returns Mock object with isDone() method
 */
export function setupRetryMock(
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
  endpoint: string,
  failCount: number,
  successStatusCode: number,
  successBody: any,
  failStatusCode: number = 500,
  failBody: any = { error: 'Internal Server Error' },
  validateToken: boolean = true,
): { isDone: () => boolean; pendingMocks: () => string[] } {
  const baseUrl = ANYTHINGLLM_BASE_URL;

  // Use mock HTTP server for E2E tests
  // Use port 3002 for mock server to avoid collision with real AnythingLLM on 3001
  const mockServerPort = 3002; // Always use 3002 for mock server

  // Start mock server if not already running
  startMockServer(mockServerPort).catch(() => {
    // Ignore errors
  });

  // Set up retry logic in the mock server
  // The mock server will track attempts and return failures for the first failCount attempts,
  // then return success
  setMockResponse(
    method,
    endpoint,
    successStatusCode,
    successBody,
    validateToken,
    failCount,
    failStatusCode,
    failBody,
  );

  // Return a mock object that tracks if the endpoint was called
  // isDone() returns true if the endpoint was called at least once
  // For retry logic, we want to verify it was called enough times to succeed
  const mockKey = `${method.toUpperCase()} ${baseUrl}${endpoint}`;
  return {
    isDone: () => {
      // Check if mock was called and if retry logic completed (attemptCount > failCount)
      const mock = getMockResponseForRetry(method, endpoint);
      if (!mock) return false;
      // For retry logic, isDone means it was called enough times to succeed
      // (attemptCount > failCount means it succeeded)
      if (mock.failCount !== undefined && mock.failCount > 0) {
        return mock.attemptCount > mock.failCount;
      }
      // For non-retry mocks, just check if it was called
      return mock.wasCalled;
    },
    pendingMocks: () => {
      const mock = getMockResponseForRetry(method, endpoint);
      if (!mock) return [mockKey];
      if (mock.failCount !== undefined && mock.failCount > 0) {
        return mock.attemptCount > mock.failCount ? [] : [mockKey];
      }
      return mock.wasCalled ? [] : [mockKey];
    },
  };
}

// Helper to get mock response (needed for isDone check)
// Use the imported function directly instead of require() to avoid Jest teardown issues
function getMockResponseForRetry(method: string, path: string): any {
  return getMockResponse(method, path);
}

/**
 * Setup nock interceptor that returns malformed response
 * Useful for testing edge cases
 *
 * @param method - HTTP method
 * @param endpoint - API endpoint path
 * @param responseType - Type of malformed response ('invalid-json', 'missing-properties', 'unexpected-status')
 * @param validateToken - Whether to validate token is HS256 (default: true)
 * @returns nock scope
 */
export function setupMalformedResponseMock(
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
  endpoint: string,
  responseType: 'invalid-json' | 'missing-properties' | 'unexpected-status',
  validateToken: boolean = true,
): nock.Scope {
  const baseUrl = ANYTHINGLLM_BASE_URL;
  const interceptor = nock(baseUrl)[method](endpoint);

  if (validateToken) {
    return interceptor.reply(function (_uri, _requestBody) {
      try {
        // Validate Authorization header contains HS256 token
        const _headers = this.req.headers as Record<
          string,
          string | string[] | undefined
        >;
        verifyAuthorizationHeader(_headers);
      } catch (error) {
        return [
          401,
          {
            error: 'Unauthorized',
            message:
              error instanceof Error
                ? error.message
                : 'Token validation failed',
          },
        ];
      }

      switch (responseType) {
        case 'invalid-json':
          return [200, 'Invalid JSON response'];
        case 'missing-properties':
          return [200, { success: true }]; // Missing expected properties
        case 'unexpected-status':
          return [418, { error: "I'm a teapot" }]; // Unexpected status code
        default:
          return [500, { error: 'Unknown malformed response type' }];
      }
    });
  } else {
    return interceptor.reply(function () {
      switch (responseType) {
        case 'invalid-json':
          return [200, 'Invalid JSON response'];
        case 'missing-properties':
          return [200, { success: true }];
        case 'unexpected-status':
          return [418, { error: "I'm a teapot" }];
        default:
          return [500, { error: 'Unknown malformed response type' }];
      }
    });
  }
}

/**
 * Clean up all interceptors and re-enable network connections
 * Call this in afterEach hooks
 *
 * CRITICAL: Do NOT close the MockAgent here - it's set as the global dispatcher
 * and closing it causes ClientDestroyedError when subsequent tests try to use fetch.
 * The MockAgent should remain active for the entire test suite.
 */
export function cleanupNock(): void {
  // Clean up mock HTTP server
  clearMocks();

  // CRITICAL: Do NOT close the MockAgent - it's the global dispatcher and must remain active
  // Closing it causes ClientDestroyedError when fetch tries to use the destroyed client
  // Instead, just clear any interceptors (if we were using them)
  // The MockAgent is created once in setup-e2e.ts and should persist for all tests
  const mockAgent = (globalThis as any).__undiciMockAgent;
  if (mockAgent) {
    try {
      // Only clear interceptors, don't close the agent
      // The agent needs to stay alive as the global dispatcher
      // We're using a mock HTTP server now, so we don't need to clear interceptors
      // But if we did, we'd use: mockAgent.get('http://localhost:3001').clearInterceptors()
      // DO NOT call mockAgent.close() here - it destroys the client while it's still the global dispatcher
    } catch (_e) {
      // Ignore errors
    }
  }
  // Clean up nock
  nock.cleanAll();
  nock.enableNetConnect();
}

/**
 * Setup interceptors for test suite
 * Uses mock HTTP server for native fetch interception in E2E tests
 * Call this in beforeEach hooks
 */
export function setupNock(): void {
  // Start mock HTTP server for AnythingLLM
  // This works with native fetch() because it's a real HTTP server
  // Use port 3002 for mock server to avoid collision with real AnythingLLM on 3001
  const mockServerPort = 3002; // Always use 3002 for mock server

  startMockServer(mockServerPort).catch(() => {
    // Ignore errors
  });

  // Clear any existing mocks
  clearMocks();

  // Ensure nock is active (for other tests that might use it)
  if (!nock.isActive()) {
    nock.activate();
  }
  nock.cleanAll();
  // Disable all network connections first
  nock.disableNetConnect();
  // Allow connections to localhost:3000 (Keystone API) and localhost:3002 (Mock AnythingLLM server)
  nock.enableNetConnect((host) => {
    // Allow localhost:3000 (Keystone API) and localhost:3002 (Mock AnythingLLM server)
    const allowed =
      host === 'localhost:3000' ||
      host === '127.0.0.1:3000' ||
      host === 'localhost:3002' ||
      host === '127.0.0.1:3002';
    return allowed;
  });

  // Reset undici MockAgent interceptors (for other tests that might use it)
  const mockAgent = (globalThis as any).__undiciMockAgent;
  if (mockAgent) {
    try {
      // DON'T deactivate/reactivate - that clears interceptors!
      // Just ensure netConnect is still configured
      mockAgent.disableNetConnect();
      mockAgent.enableNetConnect('localhost:3000');
      mockAgent.enableNetConnect('127.0.0.1:3000');
      // Also allow mock server
      mockAgent.enableNetConnect('localhost:3002');
      mockAgent.enableNetConnect('127.0.0.1:3002');
    } catch (_e) {
      // Ignore errors during reset
    }
  }
}

/**
 * Create admin context for delegated tokens
 * Returns the standard admin context used when no user context is available
 *
 * @returns Admin context object
 */
export function createAdminContext(): { userId: string; roles: string[] } {
  return { ...ADMIN_CONTEXT };
}
