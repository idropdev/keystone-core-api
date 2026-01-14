import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import {
  AccessGrantDomainService,
  Actor,
} from './domain/services/access-grant.domain.service';
import { DocumentAccessDomainService } from '../document-processing/domain/services/document-access.domain.service';
import { CreateAccessGrantDto } from './dto/create-access-grant.dto';
import { ListAccessGrantsDto } from './dto/list-access-grants.dto';
import { AccessGrantResponseDto } from './dto/access-grant-response.dto';
import { AccessGrant } from './domain/entities/access-grant.entity';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { ManagerRepositoryPort } from '../managers/domain/repositories/manager.repository.port';

/**
 * Access Control Service (Application Layer)
 *
 * Thin facade over AccessGrantDomainService that handles:
 * - DTO transformations (domain → response DTO)
 * - Pagination formatting
 * - Authorization checks at application layer
 *
 * Business logic lives in domain service.
 */
@Injectable()
export class AccessControlService {
  constructor(
    private readonly accessGrantDomainService: AccessGrantDomainService,
    private readonly documentAccessService: DocumentAccessDomainService,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
  ) {}

  /**
   * Create an access grant
   *
   * @param dto - Grant creation data
   * @param actor - Actor creating the grant
   * @returns Created access grant as DTO
   */
  async createGrant(
    dto: CreateAccessGrantDto,
    actor: Actor,
  ): Promise<AccessGrantResponseDto> {
    // Business logic handled by domain service
    const grant = await this.accessGrantDomainService.createGrant(dto, actor);

    return this.toResponseDto(grant);
  }

  /**
   * Revoke an access grant
   *
   * @param grantId - Grant ID to revoke
   * @param actor - Actor revoking the grant
   */
  async revokeGrant(grantId: number, actor: Actor): Promise<void> {
    await this.accessGrantDomainService.revokeGrant(grantId, actor);
  }

  /**
   * List access grants with filtering and pagination
   *
   * Authorization:
   * - If documentId provided: actor must be origin manager OR grant subject
   * - If no documentId: return actor's own grants only
   *
   * @param query - Query parameters (documentId, subjectType, subjectId, page, limit)
   * @param actor - Actor requesting the list
   * @returns Paginated list of access grants
   */
  async listGrants(
    query: ListAccessGrantsDto,
    actor: Actor,
  ): Promise<InfinityPaginationResponseDto<AccessGrantResponseDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    let grants: AccessGrant[] = [];

    if (query.documentId) {
      // List grants for a specific document
      // Authorization: actor must be origin manager OR grant subject
      const document = await this.documentAccessService.getDocument(
        query.documentId,
        actor,
      );

      // Get all active grants for the document
      grants = await this.accessGrantDomainService.getActiveGrants(
        query.documentId,
      );

      // Filter by subject if provided
      if (query.subjectType && query.subjectId) {
        grants = grants.filter(
          (grant) =>
            grant.subjectType === query.subjectType &&
            grant.subjectId === query.subjectId,
        );
      } else if (query.subjectType) {
        grants = grants.filter(
          (grant) => grant.subjectType === query.subjectType,
        );
      }

      // If actor is not origin manager, filter to only their own grants
      // NOTE: actor.id is the User ID, but originManagerId is the Manager ID
      // We need to resolve the Manager ID from the User ID for managers
      let isOriginManager = false;
      if (actor.type === 'manager') {
        const manager = await this.managerRepository.findByUserId(actor.id);
        if (manager && document.originManagerId === manager.id) {
          isOriginManager = true;
        }
      }

      if (!isOriginManager) {
        grants = grants.filter(
          (grant) =>
            grant.subjectType === actor.type && grant.subjectId === actor.id,
        );
      }
    } else {
      // List actor's own grants
      // Type assertion: admins are already filtered out in controller
      if (actor.type === 'admin') {
        throw new ForbiddenException(
          'Admins do not have document-level access',
        );
      }
      grants = await this.accessGrantDomainService.getActiveGrantsForSubject(
        actor.type as 'user' | 'manager',
        actor.id,
      );

      // Apply filters if provided
      if (query.subjectType) {
        grants = grants.filter(
          (grant) => grant.subjectType === query.subjectType,
        );
      }
    }

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedGrants = grants.slice(skip, skip + limit);

    // Transform to DTOs
    const data = paginatedGrants.map((grant) => this.toResponseDto(grant));

    return infinityPagination(data, { page, limit });
  }

  /**
   * Get actor's active grants (my-grants endpoint)
   *
   * @param actor - Actor requesting their grants
   * @param query - Optional pagination parameters
   * @returns Paginated list of actor's active grants
   */
  async getMyGrants(
    actor: Actor,
    query?: { page?: number; limit?: number },
  ): Promise<InfinityPaginationResponseDto<AccessGrantResponseDto>> {
    const page = query?.page || 1;
    const limit = query?.limit || 20;

    // Type assertion: admins are already filtered out in controller
    if (actor.type === 'admin') {
      throw new ForbiddenException('Admins do not have document-level access');
    }
    const grants =
      await this.accessGrantDomainService.getActiveGrantsForSubject(
        actor.type as 'user' | 'manager',
        actor.id,
      );

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedGrants = grants.slice(skip, skip + limit);

    // Transform to DTOs
    const data = paginatedGrants.map((grant) => this.toResponseDto(grant));

    return infinityPagination(data, { page, limit });
  }

  /**
   * Transform domain entity to response DTO
   *
   * Normalizes undefined optional fields to null for consistent JSON serialization
   */
  private toResponseDto(grant: AccessGrant): AccessGrantResponseDto {
    const dto = plainToClass(AccessGrantResponseDto, grant, {
      excludeExtraneousValues: true,
    });

    // Normalize undefined to null for optional fields (JSON doesn't have undefined)
    // This ensures consistent API responses and matches the documentation
    return {
      ...dto,
      revokedAt: dto.revokedAt ?? null,
      revokedByType: dto.revokedByType ?? null,
      revokedById: dto.revokedById ?? null,
    };
  }
}
