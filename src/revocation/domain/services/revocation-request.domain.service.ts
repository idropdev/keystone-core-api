import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { RevocationRequestRepositoryPort } from '../repositories/revocation-request.repository.port';
import { RevocationRequest } from '../entities/revocation-request.entity';
import { DocumentRepositoryPort } from '../../../document-processing/domain/ports/document.repository.port';
import { AccessGrantDomainService, Actor } from '../../../access-control/domain/services/access-grant.domain.service';
import { AuditService } from '../../../audit/audit.service';
import { AuthEventType } from '../../../audit/audit.service';

/**
 * Revocation Request Domain Service
 * 
 * Handles the workflow for revoking document access:
 * 1. Create request (any user/manager with access)
 * 2. Approve request (only origin manager)
 * 3. Deny request (only origin manager)
 * 4. Cancel request (requester only)
 * 
 * State Machine:
 * - pending → approved (origin manager)
 * - pending → denied (origin manager)
 * - pending → cancelled (requester)
 * - approved/denied/cancelled → (terminal states, no transitions)
 * 
 * HIPAA Compliance:
 * - All workflow steps audit logged
 * - No PHI in logs
 * - Only origin manager can approve/deny
 */
@Injectable()
export class RevocationRequestDomainService {
  constructor(
    private readonly revocationRepository: RevocationRequestRepositoryPort,
    @Inject('DocumentRepositoryPort')
    private readonly documentRepository: DocumentRepositoryPort,
    private readonly accessGrantDomainService: AccessGrantDomainService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a revocation request
   * 
   * Validation:
   * - Document must exist
   * - Requester must have access to the document
   * - Cannot create duplicate pending request for same document/subject
   * 
   * Request Types:
   * - self_revocation: Requester revoking their own access
   * - user_revocation: Manager revoking a user's access
   * - manager_revocation: Manager revoking another manager's access
   * 
   * @param documentId - Document UUID
   * @param requestType - Type of revocation request
   * @param cascadeToSecondaryManagers - If true, revoke secondary manager grants when approved
   * @param actor - Actor creating the request
   * @returns Created revocation request
   */
  async createRequest(
    documentId: string,
    requestType: 'self_revocation' | 'user_revocation' | 'manager_revocation',
    cascadeToSecondaryManagers: boolean,
    actor: Actor,
  ): Promise<RevocationRequest> {
    // 1. Validate document exists
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    // 2. Validate requester has access
    const hasAccess = await this.accessGrantDomainService.hasAccess(
      documentId,
      actor.type,
      actor.id,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        'Requester does not have access to this document',
      );
    }

    // 3. Validate request type matches actor type
    if (requestType === 'self_revocation' && actor.type === 'admin') {
      throw new BadRequestException('Admins cannot create revocation requests');
    }

    // 4. Check for existing pending request (prevent duplicates)
    const existingPending = await this.revocationRepository.findPendingByDocumentId(
      documentId,
    );
    const duplicate = existingPending.find(
      (req) =>
        req.requestedByType === actor.type &&
        req.requestedById === actor.id &&
        req.requestType === requestType,
    );
    if (duplicate) {
      throw new BadRequestException(
        'Pending revocation request already exists for this document',
      );
    }

    // 5. Create request
    // Type assertion: admins are already filtered out in controller
    if (actor.type === 'admin') {
      throw new BadRequestException('Admins cannot create revocation requests');
    }
    const request = await this.revocationRepository.create({
      documentId,
      requestedByType: actor.type as 'user' | 'manager',
      requestedById: actor.id,
      requestType,
      status: 'pending',
      cascadeToSecondaryManagers,
    });

    // 6. Audit log
    this.auditService.logAuthEvent({
      userId: actor.id,
      provider: 'system',
      event: AuthEventType.REVOCATION_REQUESTED,
      success: true,
      metadata: {
        requestId: request.id,
        documentId,
        requestType,
        cascadeToSecondaryManagers,
      },
    });

    return request;
  }

  /**
   * Approve a revocation request (origin manager only)
   * 
   * Validation:
   * - Request must exist and be in 'pending' status
   * - Actor must be origin manager
   * - Document must exist
   * 
   * Actions:
   * - Revoke access grants for the subject
   * - If cascadeToSecondaryManagers: revoke secondary manager grants
   * - Update request status to 'approved'
   * 
   * @param requestId - Revocation request ID
   * @param reviewNotes - Optional notes from origin manager
   * @param actor - Actor approving (must be origin manager)
   * @returns Updated revocation request
   */
  async approveRequest(
    requestId: number,
    reviewNotes: string | undefined,
    actor: Actor,
  ): Promise<RevocationRequest> {
    // 1. Get request
    const request = await this.revocationRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException(`Revocation request ${requestId} not found`);
    }

    // 2. Validate status
    if (request.status !== 'pending') {
      throw new BadRequestException(
        `Cannot approve request in status: ${request.status}`,
      );
    }

    // 3. Validate document exists
    const document = await this.documentRepository.findById(request.documentId);
    if (!document) {
      throw new NotFoundException(
        `Document ${request.documentId} not found`,
      );
    }

    // 4. Validate actor is origin manager
    if (actor.type !== 'manager' || document.originManagerId !== actor.id) {
      throw new ForbiddenException(
        'Only origin manager can approve revocation requests',
      );
    }

    // 5. Revoke access grants
    // TODO: Implement grant revocation logic based on request type
    // For now, we'll need to identify the subject from the request
    // This is complex and depends on the request type and context
    // For self_revocation: revoke requester's grants
    // For user_revocation/manager_revocation: need subject ID from request context
    // This will require extending the request entity or DTO to include subject info

    // 6. Update request status
    const updated = await this.revocationRepository.update(requestId, {
      status: 'approved',
      reviewNotes,
      reviewedBy: actor.id,
      reviewedAt: new Date(),
    });

    // 7. Audit log
    this.auditService.logAuthEvent({
      userId: actor.id,
      provider: 'system',
      event: AuthEventType.REVOCATION_APPROVED,
      success: true,
      metadata: {
        requestId,
        documentId: request.documentId,
        cascadeToSecondaryManagers: request.cascadeToSecondaryManagers,
      },
    });

    return updated;
  }

  /**
   * Deny a revocation request (origin manager only)
   * 
   * Validation:
   * - Request must exist and be in 'pending' status
   * - Actor must be origin manager
   * 
   * @param requestId - Revocation request ID
   * @param reviewNotes - Optional notes from origin manager
   * @param actor - Actor denying (must be origin manager)
   * @returns Updated revocation request
   */
  async denyRequest(
    requestId: number,
    reviewNotes: string | undefined,
    actor: Actor,
  ): Promise<RevocationRequest> {
    // 1. Get request
    const request = await this.revocationRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException(`Revocation request ${requestId} not found`);
    }

    // 2. Validate status
    if (request.status !== 'pending') {
      throw new BadRequestException(
        `Cannot deny request in status: ${request.status}`,
      );
    }

    // 3. Validate document exists
    const document = await this.documentRepository.findById(request.documentId);
    if (!document) {
      throw new NotFoundException(
        `Document ${request.documentId} not found`,
      );
    }

    // 4. Validate actor is origin manager
    if (actor.type !== 'manager' || document.originManagerId !== actor.id) {
      throw new ForbiddenException(
        'Only origin manager can deny revocation requests',
      );
    }

    // 5. Update request status
    const updated = await this.revocationRepository.update(requestId, {
      status: 'denied',
      reviewNotes,
      reviewedBy: actor.id,
      reviewedAt: new Date(),
    });

    // 6. Audit log
    this.auditService.logAuthEvent({
      userId: actor.id,
      provider: 'system',
      event: AuthEventType.REVOCATION_DENIED,
      success: true,
      metadata: {
        requestId,
        documentId: request.documentId,
      },
    });

    return updated;
  }

  /**
   * Cancel a revocation request (requester only)
   * 
   * Validation:
   * - Request must exist and be in 'pending' status
   * - Actor must be the requester
   * 
   * @param requestId - Revocation request ID
   * @param actor - Actor cancelling (must be requester)
   * @returns Updated revocation request (soft deleted)
   */
  async cancelRequest(requestId: number, actor: Actor): Promise<void> {
    // 1. Get request
    const request = await this.revocationRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException(`Revocation request ${requestId} not found`);
    }

    // 2. Validate status
    if (request.status !== 'pending') {
      throw new BadRequestException(
        `Cannot cancel request in status: ${request.status}`,
      );
    }

    // 3. Validate actor is requester
    if (
      request.requestedByType !== actor.type ||
      request.requestedById !== actor.id
    ) {
      throw new ForbiddenException(
        'Only the requester can cancel a revocation request',
      );
    }

    // 4. Soft delete (cancel)
    await this.revocationRepository.softDelete(requestId);

    // 5. Audit log
    this.auditService.logAuthEvent({
      userId: actor.id,
      provider: 'system',
      event: AuthEventType.REVOCATION_CANCELLED,
      success: true,
      metadata: {
        requestId,
        documentId: request.documentId,
      },
    });
  }

  /**
   * Get revocation request by ID
   */
  async getRequest(requestId: number): Promise<RevocationRequest> {
    const request = await this.revocationRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException(`Revocation request ${requestId} not found`);
    }
    return request;
  }

  /**
   * List revocation requests for a document
   */
  async listRequestsByDocument(
    documentId: string,
  ): Promise<RevocationRequest[]> {
    return this.revocationRepository.findByDocumentId(documentId);
  }

  /**
   * List revocation requests by requester
   */
  async listRequestsByRequester(
    requestedByType: 'user' | 'manager',
    requestedById: number,
  ): Promise<RevocationRequest[]> {
    return this.revocationRepository.findByRequester(
      requestedByType,
      requestedById,
    );
  }
}

