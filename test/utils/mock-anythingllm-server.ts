/**
 * Mock AnythingLLM HTTP Server
 *
 * This server runs on localhost:3001 and intercepts requests from the NestJS app
 * to return mocked responses. This works with native fetch() because it's a real
 * HTTP server, not an interceptor.
 *
 * CRITICAL: This is a simple mock server. For production-like E2E tests, use a
 * real AnythingLLM instance. This is only for testing failure scenarios.
 */

import * as http from 'http';
import * as url from 'url';
// Store mock responses keyed by method + path
interface MockResponse {
  statusCode: number;
  body: any;
  validateToken: boolean;
  wasCalled: boolean;
  // Retry logic support
  failCount?: number; // Number of times to fail before succeeding
  failStatusCode?: number; // Status code to return on failures
  failBody?: any; // Body to return on failures
  attemptCount: number; // Track number of attempts
}

const mockResponses = new Map<string, MockResponse>();

// Get or create a mock response entry
export function getMockResponse(
  method: string,
  path: string,
): MockResponse | undefined {
  // Normalize path to ensure it starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const key = `${method.toUpperCase()} ${normalizedPath}`;
  return mockResponses.get(key);
}

// Set a mock response
export function setMockResponse(
  method: string,
  path: string,
  statusCode: number,
  body: any,
  validateToken: boolean = true,
  failCount?: number,
  failStatusCode?: number,
  failBody?: any,
): void {
  // Normalize path to ensure it starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const key = `${method.toUpperCase()} ${normalizedPath}`;
  mockResponses.set(key, {
    statusCode,
    body,
    validateToken,
    wasCalled: false,
    failCount,
    failStatusCode,
    failBody,
    attemptCount: 0,
  });
}

// Check if a mock was called
export function isMockCalled(method: string, path: string): boolean {
  const mock = getMockResponse(method, path);
  return mock?.wasCalled || false;
}

// Clear all mocks
export function clearMocks(): void {
  mockResponses.clear();
}

// Verify HS256 token (delegated token)
function verifyHS256Token(token: string): void {
  // For now, just check that it's a JWT
  // In a real implementation, we'd verify the signature
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  // Decode payload to verify it's a delegated token
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!payload.iss || payload.iss !== 'keystone') {
      throw new Error('Token issuer is not keystone');
    }
    if (!payload.aud || payload.aud !== 'anythingllm') {
      throw new Error('Token audience is not anythingllm');
    }
  } catch (e) {
    throw new Error(
      `Invalid token payload: ${e instanceof Error ? e.message : 'Unknown error'}`,
    );
  }
}

// Create HTTP server
let server: http.Server | null = null;
let serverPort: number = 3002; // Use 3002 to avoid collision with real AnythingLLM on 3001

export function startMockServer(port: number = 3002): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve();
      return;
    }

    serverPort = port;
    server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url || '', true);
      const pathname = parsedUrl.pathname || '';
      const method = req.method || 'GET';

      // Remove /api prefix if present (baseUrl includes /api, e.g., http://localhost:3001/api)
      // Request path will be /api/v1/workspace/new, we need to extract /v1/workspace/new
      const pathWithoutApi = pathname.startsWith('/api')
        ? pathname.substring(4)
        : pathname;
      // Ensure path starts with / for matching
      const normalizedPath = pathWithoutApi.startsWith('/')
        ? pathWithoutApi
        : `/${pathWithoutApi}`;

      const mock = getMockResponse(method, normalizedPath);

      if (mock) {
        mock.wasCalled = true;
        mock.attemptCount = (mock.attemptCount || 0) + 1;

        // Handle retry logic: fail N times, then succeed
        let responseStatusCode = mock.statusCode;
        let responseBody = mock.body;

        if (mock.failCount !== undefined && mock.failCount > 0) {
          if (mock.attemptCount <= mock.failCount) {
            // Still in failure phase - return failure response
            responseStatusCode = mock.failStatusCode || 500;
            responseBody = mock.failBody || { error: 'Internal Server Error' };
          } else {
            // Past failure phase - return success response
            responseStatusCode = mock.statusCode;
            responseBody = mock.body;
          }
        }

        // Validate token if required
        if (mock.validateToken) {
          try {
            const authHeader =
              req.headers.authorization || req.headers.Authorization;
            const authValue = Array.isArray(authHeader)
              ? authHeader[0]
              : authHeader;
            if (!authValue || !authValue.startsWith('Bearer ')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  error: 'Unauthorized',
                  message: 'Missing or invalid Authorization header',
                }),
              );
              return;
            }

            const token = authValue.substring(7);
            verifyHS256Token(token);
          } catch (error) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Unauthorized',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Token validation failed',
              }),
            );
            return;
          }
        }

        // Return mocked response (using retry logic if applicable)
        res.writeHead(responseStatusCode, {
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify(responseBody));
      } else {
        // No mock found - return 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Not Found',
            message: `No mock configured for ${method} ${pathWithoutApi}`,
          }),
        );
      }
    });

    server.listen(port, () => {
      resolve();
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

export function stopMockServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    // Close all active connections before closing the server
    // This ensures no open handles remain
    if (typeof (server as any).closeAllConnections === 'function') {
      (server as any).closeAllConnections();
    }

    server.close((err) => {
      if (err) {
        reject(err);
      } else {
        server = null;
        resolve();
      }
    });
  });
}

export function getServerPort(): number {
  return serverPort;
}
