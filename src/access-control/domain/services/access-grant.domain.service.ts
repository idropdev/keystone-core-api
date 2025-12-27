import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { AccessGrantRepository } from '../repositories/access-grant.repository.port';
import { AccessGrant } from '../entities/access-grant.entity';
import { CreateAccessGrantDto } from '../../dto/create-access-grant.dto';
import { DocumentRepositoryPort } from '../../../document-processing/domain/ports/document.repository.port';
import { ManagerRepositoryPort } from '../../../managers/domain/repositories/manager.repository.port';
import { NullableType } from '../../../utils/types/nullable.type';

/**
 * Actor type for access control operations
 */
export type ActorType = 'user' | 'manager' | 'admin';

/**
 * Actor object containing type and ID
 */
export interface Actor {
  type: ActorType;
  id: number;
}

/**
 * AccessGrantDomainService
 * 
 * Handles access grant creation, revocation, and access resolution.
 * 
 * Key Rules:
 * - Origin manager has implicit access (no AccessGrant needed)
 * - All other access requires explicit AccessGrant
 * - Access resolution: origin manager OR active AccessGrant
 * 
 * HIPAA Compliance:
 * - No PHI in logs
 * - All access decisions audited
 */
@Injectable()
export class AccessGrantDomainService {
  constructor(
    private readonly accessGrantRepository: AccessGrantRepository,
    @Inject('DocumentRepositoryPort')
    private readonly documentRepository: DocumentRepositoryPort,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
  ) {}

  /**
   * Check if an actor has access to a document
   * 
   * Access Resolution Logic:
   * 1. If actor is origin manager → implicit access (return true)
   * 2. Otherwise → check for active AccessGrant
   * 
   * @param documentId - Document UUID
   * @param actorType - 'user' | 'manager' | 'admin'
   * @param actorId - User/Manager ID
   * @returns true if actor has access, false otherwise
   */
  async hasAccess(
    documentId: string,
    actorType: ActorType,
    actorId: number,
  ): Promise<boolean> {
    // 1. Get document
    const document = await this.documentRepository.findById(documentId);
    if (!document) {
      return false;
    }

    // 2. Check if actor is origin manager (implicit access)
    // Handles both manager-managed and self-managed documents:
    // - Self-managed: originManagerId IS NULL, user uploaded it (originUserContextId matches)
    // - Manager-managed: originManagerId IS NOT NULL, manager ID matches
    if (document.originManagerId === null) {
      // Self-managed document: user acts as origin manager if they uploaded it
      if (actorType === 'user' && document.originUserContextId === actorId) {
        return true;
      }
    } else if (actorType === 'manager') {
      // Manager-managed document: check if manager is origin manager
      // NOTE: actorId is the User ID, but originManagerId is the Manager ID
      // We need to resolve the Manager ID from the User ID
      const manager = await this.managerRepository.findByUserId(actorId);
      if (manager && document.originManagerId === manager.id) {
        return true;
      }
    }

    // 3. Admins have no document-level access (hard deny)
    if (actorType === 'admin') {
      return false;
    }

    // 4. Check for active AccessGrant
    const grant = await this.accessGrantRepository.findActive(
      documentId,
      actorType, // 'user' or 'manager'
      actorId,
    );

    return !!grant;
  }

  /**
   * Create a new access grant
   * 
   * Validation:
   * - Document must exist
   * - Grantor must have authority (origin manager or user with delegated grant)
   * - Subject cannot be origin manager (they have implicit access)
   * 
   * @param dto - Grant creation data
   * @param grantor - Actor creating the grant
   * @returns Created AccessGrant
   */
  async createGrant(
    dto: CreateAccessGrantDto,
    grantor: Actor,
  ): Promise<AccessGrant> {
    // 1. Validate document exists
    const document = await this.documentRepository.findById(dto.documentId);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // 2. Validate grantor has authority
    // Origin manager can create any grant
    // Users with delegated grants can create derived grants
    const grantorHasAccess = await this.hasAccess(
      dto.documentId,
      grantor.type,
      grantor.id,
    );

    if (!grantorHasAccess) {
      throw new ForbiddenException(
        'Grantor does not have authority to create access grants for this document',
      );
    }

    // 3. Validate subject is not origin manager (they have implicit access)
    // Check for both self-managed and manager-managed documents
    if (document.originManagerId === null) {
      // Self-managed: user who uploaded it is origin manager
      if (
        dto.subjectType === 'user' &&
        document.originUserContextId === dto.subjectId
      ) {
        throw new BadRequestException(
          'Cannot create grant for origin manager (they have implicit access)',
        );
      }
    } else if (dto.subjectType === 'manager') {
      // Manager-managed: check if manager is origin manager
      // NOTE: dto.subjectId is the User ID, but originManagerId is the Manager ID
      const manager =
        await this.managerRepository.findByUserId(dto.subjectId);
      if (manager && document.originManagerId === manager.id) {
        throw new BadRequestException(
          'Cannot create grant for origin manager (they have implicit access)',
        );
      }
    }

    // 4. Check if grant already exists
    const existingGrant = await this.accessGrantRepository.findActive(
      dto.documentId,
      dto.subjectType,
      dto.subjectId,
    );

    if (existingGrant) {
      throw new BadRequestException(
        'Active grant already exists for this document and subject',
      );
    }

    // 5. Create grant
    const grant = await this.accessGrantRepository.create({
      documentId: dto.documentId,
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      grantType: dto.grantType,
      grantedByType: grantor.type as 'user' | 'manager',
      grantedById: grantor.id,
      revokedAt: undefined,
      revokedByType: undefined,
      revokedById: undefined,
    });

    return grant;
  }

  /**
   * Revoke an access grant
   * 
   * Validation:
   * - Grant must exist and be active
   * - Revoker must have authority (origin manager or grant creator)
   * 
   * @param grantId - Grant ID to revoke
   * @param revoker - Actor revoking the grant
   */
  async revokeGrant(grantId: number, revoker: Actor): Promise<void> {
    // 1. Get grant
    const grant = await this.accessGrantRepository.findById(grantId);
    if (!grant) {
      throw new NotFoundException('Grant not found');
    }

    // 2. Check if already revoked
    if (grant.revokedAt) {
      throw new BadRequestException('Grant is already revoked');
    }

    // 3. Validate revoker has authority
    // Get document to check origin manager
    const document = await this.documentRepository.findById(grant.documentId);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Origin manager can revoke any grant
    // Handles both self-managed and manager-managed documents
    let isOriginManager = false;
    if (document.originManagerId === null) {
      // Self-managed: user who uploaded it is origin manager
      isOriginManager =
        revoker.type === 'user' &&
        document.originUserContextId === revoker.id;
    } else if (revoker.type === 'manager') {
      // Manager-managed: check if manager is origin manager
      // NOTE: revoker.id is the User ID, but originManagerId is the Manager ID
      const manager =
        await this.managerRepository.findByUserId(revoker.id);
      if (manager && document.originManagerId === manager.id) {
        isOriginManager = true;
      }
    }

    // Grant creator can revoke their own grants (for delegated grants)
    const isGrantCreator =
      grant.grantedByType === revoker.type &&
      grant.grantedById === revoker.id;

    if (!isOriginManager && !isGrantCreator) {
      throw new ForbiddenException(
        'Revoker does not have authority to revoke this grant',
      );
    }

    // 4. Revoke grant (soft delete)
    await this.accessGrantRepository.revoke(
      grantId,
      revoker.type as 'user' | 'manager',
      revoker.id,
    );

    // TODO: If grantType is 'delegated', cascade revoke all derived grants
    // This is a future enhancement - for now, derived grants remain active
  }

  /**
   * Get all active grants for a document
   * 
   * @param documentId - Document UUID
   * @returns Array of active AccessGrants
   */
  async getActiveGrants(documentId: string): Promise<AccessGrant[]> {
    return this.accessGrantRepository.findByDocumentId(documentId);
  }

  /**
   * Get all active grants for a subject
   * 
   * @param subjectType - 'user' | 'manager'
   * @param subjectId - User/Manager ID
   * @returns Array of active AccessGrants
   */
  async getActiveGrantsForSubject(
    subjectType: 'user' | 'manager',
    subjectId: number,
  ): Promise<AccessGrant[]> {
    return this.accessGrantRepository.findBySubject(subjectType, subjectId);
  }

  /**
   * Get a specific grant by ID
   * 
   * @param grantId - Grant ID
   * @returns AccessGrant or null
   */
  async getGrantById(grantId: number): Promise<NullableType<AccessGrant>> {
    return this.accessGrantRepository.findById(grantId);
  }
}

