import { RevocationRequest } from '../entities/revocation-request.entity';

/**
 * Repository Port for RevocationRequest (Hexagonal Architecture)
 * 
 * Defines the interface for persistence operations on revocation requests.
 * Implementations can be swapped (relational, document, in-memory) without changing domain logic.
 */
export abstract class RevocationRequestRepositoryPort {
  /**
   * Create a new revocation request
   */
  abstract create(request: Omit<RevocationRequest, 'id' | 'createdAt' | 'updatedAt'>): Promise<RevocationRequest>;

  /**
   * Find revocation request by ID
   */
  abstract findById(id: number): Promise<RevocationRequest | null>;

  /**
   * Find revocation requests by document ID
   */
  abstract findByDocumentId(documentId: string): Promise<RevocationRequest[]>;

  /**
   * Find revocation requests by requester
   */
  abstract findByRequester(
    requestedByType: 'user' | 'manager',
    requestedById: number,
  ): Promise<RevocationRequest[]>;

  /**
   * Find pending requests for a document (for origin manager review)
   */
  abstract findPendingByDocumentId(documentId: string): Promise<RevocationRequest[]>;

  /**
   * Update revocation request (for status changes, review notes, etc.)
   */
  abstract update(
    id: number,
    updates: Partial<RevocationRequest>,
  ): Promise<RevocationRequest>;

  /**
   * Soft delete (cancel) a revocation request
   */
  abstract softDelete(id: number): Promise<void>;
}

