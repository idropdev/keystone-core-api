import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { DocumentRepositoryPort } from '../ports/document.repository.port';
import { Document } from '../entities/document.entity';
import {
  AccessGrantDomainService,
  Actor,
} from '../../../access-control/domain/services/access-grant.domain.service';
import { ManagerRepositoryPort } from '../../../managers/domain/repositories/manager.repository.port';
import { AuditService, AuthEventType } from '../../../audit/audit.service';

/**
 * Operation types for document access control
 */
export type Operation = 'view' | 'download' | 'trigger-ocr' | 'delete';

/**
 * List options for document listing
 */
export interface ListOptions {
  skip?: number;
  limit?: number;
  status?: string[];
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  skip: number;
  limit: number;
}

/**
 * DocumentAccessDomainService
 * 
 * Handles document access control and authorization.
 * 
 * Key Rules (from Phase 1):
 * - Origin Manager: Full custodial authority (implicit access, all operations)
 * - Secondary Manager: View-only if granted (via AccessGrant)
 * - User: View-only if granted (via AccessGrant)
 * - Admin: Hard-denied (no document access)
 * 
 * HIPAA Compliance:
 * - All access attempts logged (success and failure)
 * - No PHI in logs
 * - Access control enforced at domain layer
 */
@Injectable()
export class DocumentAccessDomainService {
  constructor(
    @Inject('DocumentRepositoryPort')
    private readonly documentRepository: DocumentRepositoryPort,
    private readonly accessGrantService: AccessGrantDomainService,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Get a document with access control enforcement
   * 
   * @param documentId - Document UUID
   * @param actor - Actor requesting access
   * @returns Document if access granted
   * @throws NotFoundException if document not found or access denied
   */
  async getDocument(documentId: string, actor: Actor): Promise<Document> {
    // 1. Hard deny admins (before any domain logic)
    if (actor.type === 'admin') {
      this.logUnauthorizedAccess(documentId, actor, 'getDocument');
      throw new ForbiddenException('Admins do not have document-level access');
    }

    // 2. Get document (no ownership filter)
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      // Don't reveal document existence to unauthorized users
      throw new NotFoundException('Document not found');
    }

    // 3. Check access via AccessGrantService
    const hasAccess = await this.accessGrantService.hasAccess(
      documentId,
      actor.type,
      actor.id,
    );

    if (!hasAccess) {
      this.logUnauthorizedAccess(documentId, actor, 'getDocument');
      // Don't reveal document existence
      throw new NotFoundException('Document not found');
    }

    // 4. Log successful access
    this.logDocumentAccess(documentId, actor, 'view', true);

    return document;
  }

  /**
   * List documents accessible to an actor
   * 
   * Filtering Logic:
   * - Origin Manager: All documents where originManagerId = actor.id
   * - Other actors: Documents with active AccessGrants
   * - Admin: Empty list (hard deny)
   * 
   * @param actor - Actor requesting list
   * @param options - Pagination and filtering options
   * @returns Paginated list of accessible documents
   */
  async listDocuments(
    actor: Actor,
    options?: ListOptions,
  ): Promise<PaginatedResult<Document>> {
    // 1. Hard deny admins
    if (actor.type === 'admin') {
      return {
        data: [],
        total: 0,
        skip: options?.skip || 0,
        limit: options?.limit || 10,
      };
    }

    // 2. Get active grants for actor
    const grants = await this.accessGrantService.getActiveGrantsForSubject(
      actor.type,
      actor.id,
    );

    // 3. Get document IDs from grants
    const documentIdsFromGrants = grants.map((grant) => grant.documentId);

    // 4. If actor is a manager, also get documents where they are origin manager
    let allDocumentIds = [...documentIdsFromGrants];

    if (actor.type === 'manager') {
      // Get Manager ID from User ID
      const manager =
        await this.managerRepository.findByUserId(actor.id);
      if (manager) {
        // Get all documents where originManagerId = manager.id
        // Note: This requires a new repository method or we fetch all and filter
        // For now, we'll use the existing findByUserId method as a workaround
        // TODO: Add findByOriginManagerId method to DocumentRepositoryPort
        const originManagerDocuments = await this.getDocumentsByOriginManager(
          manager.id,
        );
        const originManagerIds = originManagerDocuments.map((doc) => doc.id);
        allDocumentIds = [...new Set([...allDocumentIds, ...originManagerIds])];
      }
    }

    // 5. If no documents, return empty
    if (allDocumentIds.length === 0) {
      return {
        data: [],
        total: 0,
        skip: options?.skip || 0,
        limit: options?.limit || 10,
      };
    }

    // 6. Fetch documents (with pagination)
    // Note: This is a simplified implementation
    // In production, we'd want a repository method that accepts document IDs
    // For now, we'll fetch all and filter in memory (not ideal for large datasets)
    const allDocuments: Document[] = [];
    for (const docId of allDocumentIds) {
      const doc = await this.documentRepository.findById(docId);
      if (doc) {
        allDocuments.push(doc);
      }
    }

    // 7. Apply pagination
    const skip = options?.skip || 0;
    const limit = options?.limit || 10;
    const paginatedData = allDocuments.slice(skip, skip + limit);

    return {
      data: paginatedData,
      total: allDocuments.length,
      skip,
      limit,
    };
  }

  /**
   * Check if an actor can perform an operation on a document
   * 
   * Operation Authorization Matrix (from Phase 1):
   * - view: Origin manager (implicit), User/Manager with grant
   * - download: Origin manager (implicit), User/Manager with grant
   * - trigger-ocr: Origin manager ONLY
   * - delete: Origin manager ONLY
   * 
   * @param documentId - Document UUID
   * @param operation - Operation to check
   * @param actor - Actor requesting operation
   * @returns true if operation allowed, false otherwise
   */
  async canPerformOperation(
    documentId: string,
    operation: Operation,
    actor: Actor,
  ): Promise<boolean> {
    // 1. Hard deny admins
    if (actor.type === 'admin') {
      return false;
    }

    // 2. Get document
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      return false;
    }

    // 3. Check if actor is origin manager
    // NOTE: actor.id is the User ID, but originManagerId is the Manager ID
    // We need to resolve the Manager ID from the User ID
    let isOriginManager = false;
    if (actor.type === 'manager') {
      const manager =
        await this.managerRepository.findByUserId(actor.id);
      if (manager && document.originManagerId === manager.id) {
        isOriginManager = true;
      }
    }

    // 4. Origin manager operations (only origin manager can perform)
    if (operation === 'trigger-ocr' || operation === 'delete') {
      return isOriginManager;
    }

    // 5. View/Download operations (origin manager OR granted access)
    if (operation === 'view' || operation === 'download') {
      if (isOriginManager) {
        return true;
      }

      // Check for active grant
      const hasAccess = await this.accessGrantService.hasAccess(
        documentId,
        actor.type,
        actor.id,
      );

      return hasAccess;
    }

    return false;
  }

  /**
   * Helper: Get documents by origin manager ID
   * 
   * TODO: This should be a repository method
   * For now, this is a workaround that may not scale
   */
  private async getDocumentsByOriginManager(
    managerId: number,
  ): Promise<Document[]> {
    // This is a simplified implementation
    // In production, we need findByOriginManagerId in DocumentRepositoryPort
    // For now, return empty array (will be fixed when repository method is added)
    return [];
  }

  /**
   * Log document access (successful)
   */
  private logDocumentAccess(
    documentId: string,
    actor: Actor,
    operation: string,
    success: boolean,
  ): void {
    this.auditService.logAuthEvent({
      userId: String(actor.id),
      provider: 'internal',
      event: success
        ? AuthEventType.DOCUMENT_ACCESSED
        : AuthEventType.UNAUTHORIZED_DOCUMENT_ACCESS,
      success,
      metadata: {
        documentId,
        actorType: actor.type,
        actorId: actor.id,
        operation,
      },
    });
  }

  /**
   * Log unauthorized access attempt
   */
  private logUnauthorizedAccess(
    documentId: string,
    actor: Actor,
    operation: string,
  ): void {
    this.logDocumentAccess(documentId, actor, operation, false);
  }
}

