/**
 * E2E Test Setup
 *
 * This file is run before E2E tests to configure the test environment.
 *
 * CRITICAL: For Node.js 18+, native fetch() uses undici which nock cannot intercept.
 * We use undici's MockAgent to intercept native fetch requests.
 *
 * IMPORTANT: Jest overrides global variables, including fetch, which can prevent
 * undici's MockAgent from intercepting requests. We must override Jest's global fetch
 * to ensure it uses the original fetch function from Node.js's global scope.
 */

import { MockAgent, setGlobalDispatcher } from 'undici';

// CRITICAL: For Node.js 18+, native fetch() uses undici which nock cannot intercept.
// We use undici's MockAgent to intercept native fetch requests.
// This is the recommended approach for Node.js 18+ with native fetch.

// Create a MockAgent instance and set it as the global dispatcher
// This allows us to intercept all fetch requests made with native fetch
// CRITICAL: MockAgent needs to be activated BEFORE setting it as global dispatcher
// If an interceptor matches, it's used. If not, and netConnect is disabled, the request fails.
const mockAgent = new MockAgent({ connections: 1 });
// CRITICAL: Activate the MockAgent FIRST so it can intercept requests
// This must be done before setting it as global dispatcher
mockAgent.activate();
// CRITICAL: Disable all network connections
// This ensures that only intercepted requests (or explicitly allowed hosts) can make requests
mockAgent.disableNetConnect();
// Allow real connections to localhost:3000 (Keystone API)
// AnythingLLM (localhost:3001) will be intercepted by MockAgent interceptors set up in tests
mockAgent.enableNetConnect('localhost:3000');
mockAgent.enableNetConnect('127.0.0.1:3000');
// CRITICAL: Set MockAgent as global dispatcher so native fetch uses it
// This must be done AFTER activating the MockAgent
setGlobalDispatcher(mockAgent);

// CRITICAL: Jest overrides global variables, including fetch, which can prevent
// undici's MockAgent from intercepting requests. We must override Jest's global fetch
// to ensure it uses the original fetch function from Node.js's global scope.
// This ensures that undici's MockAgent can intercept requests.
// The override must be done AFTER setting the global dispatcher so fetch uses MockAgent.
// IMPORTANT: Save the original fetch BEFORE we override anything, then use that saved reference
try {
  // Save the original fetch BEFORE any overrides
  // This is the fetch that uses the MockAgent via the global dispatcher we just set
  // In Node.js 18+, fetch is available on globalThis
  const originalFetch =
    typeof globalThis !== 'undefined' && globalThis.fetch
      ? globalThis.fetch
      : typeof global !== 'undefined' && global.fetch
        ? global.fetch
        : undefined;

  if (originalFetch) {
    // Override Jest's fetch to use the saved original fetch
    // This ensures that undici's MockAgent can intercept requests via the global dispatcher
    // The originalFetch is saved after we set the global dispatcher, so it uses MockAgent
    // IMPORTANT: Use a closure that captures originalFetch, not a reference that might change
    const fetchWrapper = (input: any, init?: any) => {
      // Always use the saved originalFetch, which uses MockAgent via global dispatcher
      return originalFetch.call(globalThis, input, init);
    };

    // Override both globalThis.fetch and global.fetch
    globalThis.fetch = fetchWrapper;
    if (typeof global !== 'undefined') {
      global.fetch = fetchWrapper;
    }

    // Fetch override complete - MockAgent is now active
  }
} catch (e) {
  // Ignore errors if fetch override fails
  // The MockAgent might still work if Jest hasn't overridden fetch yet
}

// Store the mockAgent globally so test helpers can access it
(globalThis as any).__undiciMockAgent = mockAgent;

// Mock pdf-parse to prevent native binding (CustomGC) from being loaded
// This prevents open handles from @napi-rs/canvas that keep Jest from exiting
// The moduleNameMapper in jest-e2e.json should handle this, but we also mock it here
// to ensure it works for require() calls
jest.mock('pdf-parse', () => {
  return {
    PDFParse: jest.fn().mockResolvedValue({
      numpages: 1,
      numrender: 1,
      info: {},
      metadata: null,
      text: '',
      version: '1.0.0',
    }),
  };
});
