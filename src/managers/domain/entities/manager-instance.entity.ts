/**
 * Domain entity for ManagerInstance
 * Represents a specific instance/location of a healthcare provider organization
 */
export class ManagerInstance {
  id: number;
  organizationId: number;
  userId: number; // Links to User entity (manager must have role 'manager')
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  displayName?: string;
  phone?: string;
  operatingHours?: string;
}
