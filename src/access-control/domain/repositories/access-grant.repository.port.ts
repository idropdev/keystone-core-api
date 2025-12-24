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
}

