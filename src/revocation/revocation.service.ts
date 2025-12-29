import { Injectable, ForbiddenException } from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import { RevocationRequestDomainService } from './domain/services/revocation-request.domain.service';
import { DocumentAccessDomainService } from '../document-processing/domain/services/document-access.domain.service';
import { CreateRevocationRequestDto } from './dto/create-revocation-request.dto';
import { ListRevocationRequestsDto } from './dto/list-revocation-requests.dto';
import { RevocationRequestResponseDto } from './dto/revocation-request-response.dto';
import { RevocationRequest } from './domain/entities/revocation-request.entity';
import { InfinityPaginationResponseDto } from '../utils/dto/infinity-pagination-response.dto';
import { infinityPagination } from '../utils/infinity-pagination';
import { Actor } from '../access-control/domain/services/access-grant.domain.service';

/**
 * Revocation Service (Application Layer)
 *
 * Thin facade over RevocationRequestDomainService that handles:
 * - DTO transformations (domain → response DTO)
 * - Pagination formatting
 * - Authorization checks at application layer
 *
 * Business logic lives in domain service.
 */
@Injectable()
export class RevocationService {
  constructor(
    private readonly revocationDomainService: RevocationRequestDomainService,
    private readonly documentAccessService: DocumentAccessDomainService,
  ) {}

  /**
   * Create a revocation request
   */
  async createRequest(
    documentId: string,
    requestType: 'self_revocation' | 'user_revocation' | 'manager_revocation',
    cascadeToSecondaryManagers: boolean,
    actor: Actor,
  ): Promise<RevocationRequestResponseDto> {
    const request = await this.revocationDomainService.createRequest(
      documentId,
      requestType,
      cascadeToSecondaryManagers,
      actor,
    );
    return this.toResponseDto(request);
  }

  /**
   * List revocation requests with filtering and pagination
   *
   * Authorization:
   * - If documentId provided: actor must be origin manager OR requester
   * - If no documentId: return actor's own requests only
   */
  async listRequests(
    query: ListRevocationRequestsDto,
    actor: Actor,
  ): Promise<InfinityPaginationResponseDto<RevocationRequestResponseDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    let requests: RevocationRequest[] = [];

    if (query.documentId) {
      // List requests for a specific document
      // Authorization: actor must be origin manager OR requester
      const document = await this.documentAccessService.getDocument(
        query.documentId,
        actor,
      );

      // Get all requests for the document
      requests = await this.revocationDomainService.listRequestsByDocument(
        query.documentId,
      );

      // Filter by status if provided
      if (query.status) {
        requests = requests.filter((req) => req.status === query.status);
      }

      // Filter by request type if provided
      if (query.requestType) {
        requests = requests.filter(
          (req) => req.requestType === query.requestType,
        );
      }

      // If actor is not origin manager, filter to only their own requests
      const isOriginManager =
        actor.type === 'manager' && document.originManagerId === actor.id;

      if (!isOriginManager) {
        requests = requests.filter(
          (req) =>
            req.requestedByType === actor.type &&
            req.requestedById === actor.id,
        );
      }
    } else {
      // List actor's own requests
      // Type assertion: admins are already filtered out in controller
      if (actor.type === 'admin') {
        throw new ForbiddenException(
          'Admins do not have document-level access',
        );
      }
      requests = await this.revocationDomainService.listRequestsByRequester(
        actor.type as 'user' | 'manager',
        actor.id,
      );

      // Apply filters if provided
      if (query.status) {
        requests = requests.filter((req) => req.status === query.status);
      }
      if (query.requestType) {
        requests = requests.filter(
          (req) => req.requestType === query.requestType,
        );
      }
    }

    // Apply pagination
    const skip = (page - 1) * limit;
    const paginatedRequests = requests.slice(skip, skip + limit);

    // Transform to DTOs
    const data = paginatedRequests.map((req) => this.toResponseDto(req));

    return infinityPagination(data, { page, limit });
  }

  /**
   * Get revocation request by ID
   *
   * Authorization: actor must be origin manager OR requester
   */
  async getRequest(
    requestId: number,
    actor: Actor,
  ): Promise<RevocationRequestResponseDto> {
    const request = await this.revocationDomainService.getRequest(requestId);

    // Authorization: actor must be origin manager OR requester
    const document = await this.documentAccessService.getDocument(
      request.documentId,
      actor,
    );

    const isOriginManager =
      actor.type === 'manager' && document.originManagerId === actor.id;

    const isRequester =
      request.requestedByType === actor.type &&
      request.requestedById === actor.id;

    if (!isOriginManager && !isRequester) {
      throw new ForbiddenException(
        'Actor does not have permission to view this request',
      );
    }

    return this.toResponseDto(request);
  }

  /**
   * Transform domain entity to response DTO
   */
  toResponseDto(request: RevocationRequest): RevocationRequestResponseDto {
    return plainToClass(RevocationRequestResponseDto, request, {
      excludeExtraneousValues: true,
    });
  }
}
