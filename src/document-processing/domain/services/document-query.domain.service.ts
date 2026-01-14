import { Injectable, Logger, Inject } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { DocumentRepositoryPort } from '../ports/document.repository.port';
import { Document } from '../entities/document.entity';
import { AccessGrantDomainService, Actor } from '../../../access-control/domain/services/access-grant.domain.service';
import { ManagerRepositoryPort } from '../../../managers/domain/repositories/manager.repository.port';
import { UserManagerAssignmentService } from '../../../users/domain/services/user-manager-assignment.service';
import { AuditService } from '../../../audit/audit.service';
import { DocumentEntity } from '../../infrastructure/persistence/relational/entities/document.entity';
import { DocumentMapper } from '../../infrastructure/persistence/relational/mappers/document.mapper';
import { QueryBuilderService } from '../../infrastructure/query/query-builder.service';
import {
  DocumentQueryDto,
  SortDto,
  PaginationDto,
} from '../../dto/document-query.dto';
import { SelectQueryBuilder } from 'typeorm';

/**
 * Paginated query result
 */
export interface QueryResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
}

/**
 * DocumentQueryDomainService
 *
 * Handles document querying with authorization-first approach.
 * Builds document access scope using all three mechanisms:
 * 1. Implicit access (originManagerId, temporaryManagerId)
 * 2. Explicit access grants
 * 3. Manager-user assignments
 *
 * HIPAA Compliance:
 * - Authorization-first: scope built before filters applied
 * - No PHI in logs (only document IDs, not content)
 * - All queries use parameterized statements
 */
@Injectable()
export class DocumentQueryDomainService {
  private readonly logger = new Logger(DocumentQueryDomainService.name);

  constructor(
    @Inject('DocumentRepositoryPort')
    private readonly documentRepository: DocumentRepositoryPort,
    @InjectRepository(DocumentEntity)
    private readonly documentEntityRepository: Repository<DocumentEntity>,
    private readonly accessGrantService: AccessGrantDomainService,
    @Inject('ManagerRepositoryPort')
    private readonly managerRepository: ManagerRepositoryPort,
    private readonly userManagerAssignmentService: UserManagerAssignmentService,
    private readonly queryBuilderService: QueryBuilderService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Execute document query with authorization-first approach
   */
  async executeQuery(
    actor: Actor,
    queryDto: DocumentQueryDto,
  ): Promise<QueryResult<Document>> {
    // STEP 1: Build authorized document scope (BEFORE query filters)
    const authorizedDocumentIds = await this.buildDocumentScope(actor);

    // STEP 2: If no authorized documents, return empty immediately
    if (authorizedDocumentIds.length === 0) {
      const pagination = queryDto.pagination || { page: 1, limit: 20 };
      return {
        data: [],
        total: 0,
        page: pagination.page!,
        limit: pagination.limit!,
        hasNextPage: false,
      };
    }

    // STEP 3: Create QueryBuilder with scope restriction
    const queryBuilder = this.documentEntityRepository
      .createQueryBuilder('document')
      .where('document.id IN (:...documentIds)', {
        documentIds: authorizedDocumentIds,
      })
      .andWhere('document.deletedAt IS NULL');

    // STEP 4: Apply query filters (via QueryBuilderService)
    if (queryDto.query) {
      this.queryBuilderService.applyQueryFilters(
        queryBuilder,
        queryDto.query,
        'query',
      );
    }

    // STEP 5: Apply full-text search (if provided)
    if (queryDto.fullText) {
      this.queryBuilderService.applyFullTextSearch(
        queryBuilder,
        queryDto.fullText,
      );
    }

    // STEP 6: Apply sorting
    const sort = queryDto.sort || { field: 'uploadedAt', order: 'desc' };
    const sortField = this.mapFieldToColumn(sort.field!);
    queryBuilder.orderBy(`document.${sortField}`, sort.order!.toUpperCase() as 'ASC' | 'DESC');

    // STEP 7: Apply pagination
    const pagination = queryDto.pagination || { page: 1, limit: 20 };
    const page = pagination.page!;
    const limit = pagination.limit!;
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // STEP 8: Get total count (before pagination)
    const total = await queryBuilder.getCount();

    // STEP 9: Execute query
    const entities = await queryBuilder.getMany();
    const documents = entities.map(DocumentMapper.toDomain);

    // STEP 10: Log query operation (no PHI)
    this.logger.debug(
      `[QUERY] Actor type=${actor.type}, id=${actor.id}, total=${total}, returned=${documents.length}`,
    );

    return {
      data: documents,
      total,
      page,
      limit,
      hasNextPage: skip + limit < total,
    };
  }

  /**
   * Build document access scope for actor
   * Combines all three access mechanisms
   */
  async buildDocumentScope(actor: Actor): Promise<string[]> {
    if (actor.type === 'admin') {
      // Hard deny admins
      return [];
    }

    if (actor.type === 'user') {
      return this.buildUserScope(actor.id);
    }

    if (actor.type === 'manager') {
      return this.buildManagerScope(actor.id);
    }

    return [];
  }

  /**
   * Build user document scope
   * 1. Documents where temporaryManagerId = user.id
   * 2. Documents with active AccessGrants
   */
  private async buildUserScope(userId: number): Promise<string[]> {
    const documentIds = new Set<string>();

    // 1. Get documents where user is temporary manager
    const temporaryManagerDocs = await this.documentRepository.findByTemporaryManagerId(userId);
    temporaryManagerDocs.forEach((doc) => documentIds.add(doc.id));

    // 2. Get documents with active AccessGrants
    const grants = await this.accessGrantService.getActiveGrantsForSubject(
      'user',
      userId,
    );
    grants.forEach((grant) => documentIds.add(grant.documentId));

    return Array.from(documentIds);
  }

  /**
   * Build manager document scope
   * 1. Documents where originManagerId = manager.id
   * 2. Documents with active AccessGrants
   * 3. Documents of assigned users (via user_manager_assignments)
   */
  private async buildManagerScope(managerUserId: number): Promise<string[]> {
    const documentIds = new Set<string>();

    // 1. Resolve Manager ID from User ID
    const manager = await this.managerRepository.findByUserId(managerUserId);
    if (!manager) {
      this.logger.warn(
        `[BUILD MANAGER SCOPE] Manager not found for userId=${managerUserId}`,
      );
      return [];
    }

    // 2. Get documents where manager is origin manager
    const originManagerDocs = await this.documentRepository.findByOriginManagerId(manager.id);
    originManagerDocs.forEach((doc) => documentIds.add(doc.id));

    // 3. Get documents with active AccessGrants (using manager.id for grants, but grants use manager userId...)
    // NOTE: AccessGrants use subjectId which is User ID, not Manager ID
    const grants = await this.accessGrantService.getActiveGrantsForSubject(
      'manager',
      managerUserId, // AccessGrants store User ID, not Manager ID
    );
    grants.forEach((grant) => documentIds.add(grant.documentId));

    // 4. Get documents of assigned users
    // NOTE: findByManagerId takes User ID (managerUserId), not Manager ID
    const assignments = await this.userManagerAssignmentService.getAssignmentsByManager(managerUserId);
    const assignedUserIds = assignments.map((assignment) => assignment.userId);
    if (assignedUserIds.length > 0) {
      const assignedUsersDocs = await this.documentRepository.findByUserIds(assignedUserIds);
      assignedUsersDocs.forEach((doc) => documentIds.add(doc.id));
    }

    return Array.from(documentIds);
  }

  /**
   * Map field name to database column name
   */
  private mapFieldToColumn(field: string): string {
    const fieldMap: Record<string, string> = {
      id: 'id',
      status: 'status',
      documentType: 'documentType',
      fileName: 'fileName',
      mimeType: 'mimeType',
      fileSize: 'fileSize',
      pageCount: 'pageCount',
      confidence: 'confidence',
      uploadedAt: 'uploadedAt',
      processedAt: 'processedAt',
      createdAt: 'createdAt',
    };

    return fieldMap[field] || field;
  }
}
