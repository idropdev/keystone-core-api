/**
 * Domain entity for resource context
 * No infrastructure dependencies - pure domain model
 */
export interface ResourceContext {
  workspaceSlug?: string;
  threadSlug?: string;
  documentId?: string;
  targetUserId?: string; // For manager oversight operations
  [key: string]: unknown; // Allow additional context fields
}










