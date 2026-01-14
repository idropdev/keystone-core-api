/**
 * E2E Test Teardown
 *
 * This file is run after all E2E tests to clean up the test environment.
 *
 * CRITICAL: Close the MockAgent only after all tests are complete.
 * Do NOT close it in cleanupNock() or afterEach hooks - that causes ClientDestroyedError.
 */

import { setGlobalDispatcher } from 'undici';

// Jest globalTeardown must export a function
export default async function globalTeardown(): Promise<void> {
  // Clean up the global MockAgent after all tests are done
  const mockAgent = (globalThis as any).__undiciMockAgent;
  if (mockAgent) {
    try {
      // Close the MockAgent and reset the global dispatcher
      mockAgent.close();
      // Reset to default dispatcher (allows real network connections)
      setGlobalDispatcher(undefined as any);
    } catch (e) {
      // Ignore errors during cleanup
      // The agent might already be closed or destroyed
    }
  }

  // Also stop the mock HTTP server if it's running
  try {
    const { stopMockServer } = require('./utils/mock-anythingllm-server');
    await stopMockServer().catch(() => {
      // Ignore errors
    });
  } catch (e) {
    // Ignore if module not found or server not running
  }
}
