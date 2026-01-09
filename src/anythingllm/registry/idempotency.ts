import { createHash } from 'crypto';

/**
 * Idempotency Utilities
 *
 * Provides idempotency key generation for critical operations.
 * Ensures operations can be safely retried without side effects.
 */

/**
 * Generate idempotency key for workspace creation
 * Uses userId as the key (deterministic)
 */
export function generateWorkspaceIdempotencyKey(userId: string): string {
  return `workspace:${userId}`;
}

/**
 * Generate idempotency key for document upload
 * Uses file hash + userId for uniqueness
 */
export function generateDocumentUploadIdempotencyKey(
  userId: string,
  fileHash: string,
): string {
  const combined = `${userId}:${fileHash}`;
  const hash = createHash('sha256').update(combined).digest('hex').slice(0, 16);
  return `document:${hash}`;
}

/**
 * Generate idempotency key for thread creation
 * Uses workspaceSlug + userId + name hash
 */
export function generateThreadIdempotencyKey(
  workspaceSlug: string,
  userId: number,
  name?: string,
): string {
  const combined = `${workspaceSlug}:${userId}:${name || ''}`;
  const hash = createHash('sha256').update(combined).digest('hex').slice(0, 16);
  return `thread:${hash}`;
}

/**
 * Generate file hash for idempotency
 */
export function generateFileHash(fileContent: Buffer | string): string {
  const content =
    typeof fileContent === 'string' ? Buffer.from(fileContent) : fileContent;
  return createHash('sha256').update(content).digest('hex');
}
