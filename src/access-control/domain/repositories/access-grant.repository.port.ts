import { NullableType } from '../../../utils/types/nullable.type';
import { AccessGrant } from '../entities/access-grant.entity';

export abstract class AccessGrantRepository {
  /**
   * Find active grant for document and subject
   */
  abstract findActive(
    documentId: string,
    subjectType: 'user' | 'manager',
    subjectId: number,
  ): Promise<NullableType<AccessGrant>>;

  /**
   * Find all active grants for a document
   */
  abstract findByDocumentId(documentId: string): Promise<AccessGrant[]>;

  /**
   * Find all active grants for a subject
   */
  abstract findBySubject(
    subjectType: 'user' | 'manager',
    subjectId: number,
  ): Promise<AccessGrant[]>;

  /**
   * Create a new access grant
   */
  abstract create(
    data: Omit<AccessGrant, 'id' | 'createdAt'>,
  ): Promise<AccessGrant>;

  /**
   * Find grant by ID
   */
  abstract findById(id: number): Promise<NullableType<AccessGrant>>;

  /**
   * Revoke a grant (soft delete by setting revokedAt)
   */
  abstract revoke(
    id: number,
    revokedByType: 'user' | 'manager',
    revokedById: number,
  ): Promise<void>;

  /**
   * SYSTEM-100: Revoke ALL grants for a document (batch operation)
   * Used when a document is deleted - revokes all AccessGrants in single operation
   *
   * @param documentId - Document UUID
   * @param revokedByType - Type of actor revoking
   * @param revokedById - ID of actor revoking
   * @returns Number of grants revoked
   */
  abstract revokeAllByDocumentId(
    documentId: string,
    revokedByType: 'user' | 'manager',
    revokedById: number,
  ): Promise<number>;
}
