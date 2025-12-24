/**
 * Domain entity for ManagerOrganization
 * Represents the canonical organizational identity of a healthcare provider
 */
export class ManagerOrganization {
  id: number;
  name: string;
  verificationStatus: 'verified' | 'pending' | 'rejected';
  verifiedAt?: Date;
  verifiedById?: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

