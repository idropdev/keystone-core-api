/**
 * Domain entity for UserManagerAssignment
 * Represents a governance/supervision relationship between a user and a manager
 * NOTE: This is separate from document-level AccessGrants
 */
export class UserManagerAssignment {
  id: number;
  userId: number;
  managerId: number;
  assignedAt: Date;
  assignedById?: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

