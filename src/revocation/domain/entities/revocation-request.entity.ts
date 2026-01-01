/**
 * Domain entity for RevocationRequest
 *
 * Represents a workflow request to revoke access to a document.
 *
 * Workflow States:
 * - pending: Request created, awaiting origin manager approval
 * - approved: Origin manager approved, access revoked
 * - denied: Origin manager denied the request
 * - cancelled: Requester cancelled the request
 *
 * Request Types:
 * - self_revocation: User/Manager requesting to revoke their own access
 * - user_revocation: Manager requesting to revoke a user's access
 * - manager_revocation: Manager requesting to revoke another manager's access
 *
 * NOTE: Only origin manager can approve/deny requests.
 * Cascade option allows revoking secondary manager grants when revoking delegated grants.
 */
export class RevocationRequest {
  id: number;
  documentId: string; // UUID
  requestedByType: 'user' | 'manager'; // Who created the request
  requestedById: number; // User ID or Manager ID
  requestType: 'self_revocation' | 'user_revocation' | 'manager_revocation';
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  cascadeToSecondaryManagers: boolean; // If true, revoke secondary manager grants when approved
  reviewNotes?: string; // Notes from origin manager (if approved/denied)
  reviewedBy?: number; // User ID of origin manager who reviewed
  reviewedAt?: Date; // Timestamp of review
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date; // Soft delete (for cancelled requests)
}
