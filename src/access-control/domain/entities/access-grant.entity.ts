/**
 * Domain entity for AccessGrant
 * Represents document-level access permissions granted to users or managers
 *
 * NOTE: Origin managers have implicit access (no AccessGrant needed)
 * All other access requires explicit AccessGrant records
 */
export class AccessGrant {
  id: number;
  documentId: string; // UUID
  subjectType: 'user' | 'manager'; // Who receives the grant
  subjectId: number; // User ID or Manager ID
  grantType: 'owner' | 'delegated' | 'derived'; // Authority level
  grantedByType: 'user' | 'manager'; // Who created this grant
  grantedById: number; // User ID or Manager ID
  createdAt: Date;
  revokedAt?: Date; // null = active, set = revoked
  revokedByType?: 'user' | 'manager'; // Who revoked (if applicable)
  revokedById?: number; // Who revoked (if applicable)
}
