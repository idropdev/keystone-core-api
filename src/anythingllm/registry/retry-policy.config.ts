import { RetryPolicy } from './anythingllm-endpoints.registry';

/**
 * Retry Policy Configuration
 *
 * Defines retry policies for different endpoint categories.
 * Used by the registry client to handle transient failures.
 */

/**
 * Retry policy for document uploads
 * Higher retry count due to potential network issues with large files
 */
export const DOCUMENT_UPLOAD_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  retryDelayMs: 2000,
  retryOn: [500, 502, 503, 504], // Server errors
};

/**
 * Retry policy for chat/streaming operations
 * Lower retry count to avoid duplicate responses
 */
export const CHAT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  retryDelayMs: 5000,
  retryOn: [500, 502, 503, 504],
};

/**
 * Retry policy for workspace/thread operations
 * Moderate retry count for state-changing operations
 */
export const WORKSPACE_THREAD_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  retryDelayMs: 1000,
  retryOn: [500, 502, 503, 504],
};

/**
 * Retry policy for read-only operations
 * Lower retry count for idempotent reads
 */
export const READ_ONLY_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  retryDelayMs: 500,
  retryOn: [500, 502, 503, 504],
};

/**
 * Get retry policy by endpoint category
 */
export function getRetryPolicyForCategory(
  category: 'document' | 'chat' | 'workspace' | 'read',
): RetryPolicy {
  switch (category) {
    case 'document':
      return DOCUMENT_UPLOAD_RETRY_POLICY;
    case 'chat':
      return CHAT_RETRY_POLICY;
    case 'workspace':
      return WORKSPACE_THREAD_RETRY_POLICY;
    case 'read':
      return READ_ONLY_RETRY_POLICY;
    default:
      return READ_ONLY_RETRY_POLICY;
  }
}



