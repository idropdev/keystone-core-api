/**
 * AccessRequest Domain Entity
 *
 * SYSTEM-100: Access Request Workflow
 *
 * Represents a request from a manager to access a document
 * that they don't currently have access to.
 */
export class AccessRequest {
  id: number;
  documentId: string;
  requestedByManagerId: number;
  status: 'pending' | 'approved' | 'denied';
  requestReason?: string;

  // Review fields
  reviewedByManagerId?: number;
  reviewedAt?: Date;
  reviewNotes?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
