import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  Check,
} from 'typeorm';

/**
 * Revocation Request Entity (Database)
 * 
 * Represents a workflow request to revoke access to a document.
 * 
 * Workflow States:
 * - pending: Request created, awaiting origin manager approval
 * - approved: Origin manager approved, access revoked
 * - denied: Origin manager denied the request
 * - cancelled: Requester cancelled the request
 * 
 * Request Types:
 * - self_revocation: User/Manager requesting to revoke their own access
 * - user_revocation: Manager requesting to revoke a user's access
 * - manager_revocation: Manager requesting to revoke another manager's access
 * 
 * HIPAA Compliance:
 * - No PHI stored in this entity
 * - All mutations audit logged
 * - Soft delete for cancelled requests (retention compliance)
 */
@Entity('revocation_requests')
@Index(['documentId', 'status'])
@Index(['requestedByType', 'requestedById'])
@Index(['status', 'createdAt'])
@Check(`"requestType" IN ('self_revocation', 'user_revocation', 'manager_revocation')`)
@Check(`"status" IN ('pending', 'approved', 'denied', 'cancelled')`)
@Check(`"requestedByType" IN ('user', 'manager')`)
export class RevocationRequestEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', name: 'document_id' })
  documentId: string;

  @Column({ type: 'varchar', length: 20, name: 'requested_by_type' })
  requestedByType: 'user' | 'manager';

  @Column({ type: 'integer', name: 'requested_by_id' })
  requestedById: number;

  @Column({ type: 'varchar', length: 30, name: 'request_type' })
  requestType: 'self_revocation' | 'user_revocation' | 'manager_revocation';

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: 'pending' | 'approved' | 'denied' | 'cancelled';

  @Column({
    type: 'boolean',
    name: 'cascade_to_secondary_managers',
    default: false,
  })
  cascadeToSecondaryManagers: boolean;

  @Column({ type: 'text', name: 'review_notes', nullable: true })
  reviewNotes?: string;

  @Column({ type: 'integer', name: 'reviewed_by', nullable: true })
  reviewedBy?: number; // User ID of origin manager who reviewed

  @Column({ type: 'timestamp', name: 'reviewed_at', nullable: true })
  reviewedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date; // Soft delete (for cancelled requests)
}

