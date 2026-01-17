import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { AccessRequestRepository } from '../repositories/access-request.repository.port';
import { AccessRequest } from '../entities/access-request.entity';
import { AccessGrantDomainService } from './access-grant.domain.service';
import { DocumentRepositoryPort } from '../../../document-processing/domain/ports/document.repository.port';
import { ManagerRepositoryPort } from '../../../managers/domain/repositories/manager.repository.port';

/**
 * Access Request Domain Service
 *
 * SYSTEM-100: Access Request Workflow
 *
 * Handles access requests from managers to view documents
 * they don't currently have access to.
 */
@Injectable()
export class AccessRequestDomainService {
  constructor(
    @Inject('AccessRequestRepository')
    private readonly accessRequestRepository: AccessRequestRepository,
    private readonly accessGrantService: AccessGrantDomainService,
    @Inject('DocumentRepositoryPort')
    private readonly documentRepository: DocumentRepositoryPort,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
  ) {}

  /**
   * Create a new access request
   */
  async createRequest(
    documentId: string,
    requestingManagerId: number,
    requestReason?: string,
  ): Promise<AccessRequest> {
    // 1. Validate document exists
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // 2. Check if requester already has access
    const hasAccess = await this.accessGrantService.hasAccess(
      documentId,
      'manager',
      requestingManagerId,
    );
    if (hasAccess) {
      throw new BadRequestException('You already have access to this document');
    }

    // 3. Check if pending request already exists
    const pendingRequests =
      await this.accessRequestRepository.findPendingByDocumentId(documentId);
    const existingRequest = pendingRequests.find(
      (r) => r.requestedByManagerId === requestingManagerId,
    );
    if (existingRequest) {
      throw new BadRequestException(
        'You already have a pending request for this document',
      );
    }

    // 4. Create request
    return this.accessRequestRepository.create({
      documentId,
      requestedByManagerId: requestingManagerId,
      status: 'pending',
      requestReason,
    });
  }

  /**
   * Approve an access request
   * Only origin manager can approve
   */
  async approveRequest(
    requestId: number,
    reviewingManagerId: number,
    reviewNotes?: string,
  ): Promise<AccessRequest> {
    const request = await this.getAndValidateRequest(
      requestId,
      reviewingManagerId,
    );

    // Create access grant for the requester
    await this.accessGrantService.createGrant(
      {
        documentId: request.documentId,
        subjectType: 'manager',
        subjectId: request.requestedByManagerId,
        grantType: 'delegated',
      },
      { type: 'manager', id: reviewingManagerId },
    );

    // Update request status
    return this.accessRequestRepository.update(requestId, {
      status: 'approved',
      reviewedByManagerId: reviewingManagerId,
      reviewedAt: new Date(),
      reviewNotes,
    });
  }

  /**
   * Deny an access request
   * Only origin manager can deny
   */
  async denyRequest(
    requestId: number,
    reviewingManagerId: number,
    reviewNotes?: string,
  ): Promise<AccessRequest> {
    await this.getAndValidateRequest(requestId, reviewingManagerId);

    return this.accessRequestRepository.update(requestId, {
      status: 'denied',
      reviewedByManagerId: reviewingManagerId,
      reviewedAt: new Date(),
      reviewNotes,
    });
  }

  /**
   * Get pending requests for documents where actor is origin manager
   */
  async getPendingRequestsForOriginManager(
    originManagerId: number,
  ): Promise<AccessRequest[]> {
    return this.accessRequestRepository.findPendingForOriginManager(
      originManagerId,
    );
  }

  /**
   * Get requests made by a manager
   */
  async getMyRequests(managerId: number): Promise<AccessRequest[]> {
    return this.accessRequestRepository.findByRequesterId(managerId);
  }

  private async getAndValidateRequest(
    requestId: number,
    reviewingManagerId: number,
  ): Promise<AccessRequest> {
    const request = await this.accessRequestRepository.findById(requestId);
    if (!request) {
      throw new NotFoundException('Access request not found');
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('Request has already been reviewed');
    }

    // Validate reviewer is origin manager
    const document = await this.documentRepository.findById(request.documentId);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const manager =
      await this.managerRepository.findByUserId(reviewingManagerId);
    if (!manager || document.originManagerId !== manager.id) {
      throw new ForbiddenException(
        'Only the origin manager can review access requests',
      );
    }

    return request;
  }
}
