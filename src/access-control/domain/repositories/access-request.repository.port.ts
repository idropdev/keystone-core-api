import { NullableType } from '../../../utils/types/nullable.type';
import { AccessRequest } from '../entities/access-request.entity';

/**
 * AccessRequest Repository Port
 *
 * SYSTEM-100: Access Request Workflow
 */
export abstract class AccessRequestRepository {
  abstract create(
    data: Omit<AccessRequest, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AccessRequest>;

  abstract findById(id: number): Promise<NullableType<AccessRequest>>;

  abstract findByDocumentId(documentId: string): Promise<AccessRequest[]>;

  abstract findPendingByDocumentId(
    documentId: string,
  ): Promise<AccessRequest[]>;

  abstract findByRequesterId(managerId: number): Promise<AccessRequest[]>;

  abstract update(
    id: number,
    data: Partial<AccessRequest>,
  ): Promise<AccessRequest>;

  abstract findPendingForOriginManager(
    originManagerId: number,
  ): Promise<AccessRequest[]>;
}
