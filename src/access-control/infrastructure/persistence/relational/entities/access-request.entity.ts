import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { DocumentEntity } from '../../../../../document-processing/infrastructure/persistence/relational/entities/document.entity';

/**
 * AccessRequest Entity
 *
 * SYSTEM-100: Access Request Workflow
 *
 * Stores access requests from managers wanting document access.
 * Origin managers approve/deny requests, creating AccessGrants on approval.
 */
@Entity({
  name: 'access_requests',
})
export class AccessRequestEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DocumentEntity, { nullable: false })
  @JoinColumn({ name: 'document_id' })
  document: DocumentEntity;

  @Column({ name: 'document_id', type: 'uuid' })
  @Index()
  documentId: string;

  // Manager requesting access (using manager.id, not user_id)
  @Column({ name: 'requested_by_manager_id' })
  @Index()
  requestedByManagerId: number;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 50,
    default: 'pending',
  })
  @Index()
  status: 'pending' | 'approved' | 'denied';

  @Column({ name: 'request_reason', type: 'text', nullable: true })
  requestReason?: string;

  // Review (when approved/denied)
  @Column({ name: 'reviewed_by_manager_id', nullable: true })
  reviewedByManagerId?: number;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt?: Date;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
