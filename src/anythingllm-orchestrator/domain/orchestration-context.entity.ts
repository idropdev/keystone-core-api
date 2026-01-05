/**
 * Domain entity for orchestration context
 * No infrastructure dependencies - pure domain model
 */
export interface OrchestrationContext {
  requesterContext: {
    userId: string;
    roles: string[];
    sessionId?: string;
    provider?: string;
  };
  operation: string;
  resourceContext?: {
    workspaceSlug?: string;
    threadSlug?: string;
    documentId?: string;
    targetUserId?: string;
    [key: string]: unknown;
  };
  httpRequest: {
    endpoint: string;
    method: string;
    body?: unknown;
    headers?: Record<string, string>;
  };
}








