import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { DocumentEntity } from '../../../../../document-processing/infrastructure/persistence/relational/entities/document.entity';

@Entity({
  name: 'access_grants',
})
export class AccessGrantEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => DocumentEntity, { nullable: false })
  @JoinColumn({ name: 'document_id' })
  document: DocumentEntity;

  @Column({ name: 'document_id' })
  @Index()
  documentId: string;

  @Column({
    name: 'subject_type',
    type: 'varchar',
    length: 20,
  })
  @Index()
  subjectType: 'user' | 'manager';

  @Column({ name: 'subject_id', type: 'integer' })
  @Index()
  subjectId: number;

  @Column({
    name: 'grant_type',
    type: 'varchar',
    length: 20,
  })
  grantType: 'owner' | 'delegated' | 'derived';

  @Column({
    name: 'granted_by_type',
    type: 'varchar',
    length: 20,
  })
  grantedByType: 'user' | 'manager';

  @Column({ name: 'granted_by_id', type: 'integer' })
  grantedById: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  @Index()
  revokedAt?: Date;

  @Column({
    name: 'revoked_by_type',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  revokedByType?: 'user' | 'manager';

  @Column({ name: 'revoked_by_id', type: 'integer', nullable: true })
  revokedById?: number;
}
