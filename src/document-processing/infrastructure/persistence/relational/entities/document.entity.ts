import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { ManagerEntity } from '../../../../../managers/infrastructure/persistence/relational/entities/manager.entity';
import { ExtractedFieldEntity } from './extracted-field.entity';
import { DocumentStatus } from '../../../../domain/enums/document-status.enum';
import { DocumentType } from '../../../../domain/enums/document-type.enum';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';
import { ProcessingMethod } from '../../../../domain/enums/processing-method.enum';

@Entity({ name: 'documents' })
export class DocumentEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => UserEntity, { nullable: false, eager: false })
  @JoinColumn({ name: 'user_id' })
  @Index()
  user: UserEntity;

  @Column({ name: 'user_id' })
  userId: number;

  // Origin authority (IMMUTABLE - set at creation, never changes)
  // TODO: Enforce immutability at application level - originManagerId cannot be updated after creation
  // NOTE: originManagerId references managers.id, not user.id
  @ManyToOne(() => ManagerEntity, { nullable: false, eager: false })
  @JoinColumn({ name: 'origin_manager_id' })
  @Index()
  originManager: ManagerEntity;

  @Column({ name: 'origin_manager_id' })
  originManagerId: number;

  // Optional: user who uploaded (intake context, not ownership)
  // Visible only to origin manager and auditors
  @ManyToOne(() => UserEntity, { nullable: true, eager: false })
  @JoinColumn({ name: 'origin_user_context_id' })
  originUserContext?: UserEntity;

  @Column({ name: 'origin_user_context_id', nullable: true })
  originUserContextId?: number;

  @Column({ name: 'document_type', type: 'varchar', length: 50 })
  @Index()
  documentType: DocumentType;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  status: DocumentStatus;

  @Column({
    name: 'processing_method',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  processingMethod?: ProcessingMethod;

  @Column({ name: 'raw_file_uri', type: 'varchar', length: 500 })
  rawFileUri: string;

  @Column({
    name: 'processed_file_uri',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  processedFileUri?: string;

  // HIPAA NOTE: This column contains PHI - encrypted at rest by PostgreSQL
  @Column({ name: 'ocr_json_output', type: 'jsonb', nullable: true })
  ocrJsonOutput?: any;

  @Column({ name: 'extracted_text', type: 'text', nullable: true })
  extractedText?: string;

  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true })
  confidence?: number;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'file_size', type: 'integer' })
  fileSize: number;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ name: 'page_count', type: 'integer', nullable: true })
  pageCount?: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamp' })
  uploadedAt: Date;

  @Column({ name: 'processing_started_at', type: 'timestamp', nullable: true })
  @Index()
  processingStartedAt?: Date;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  @Index()
  deletedAt?: Date;

  @Column({ name: 'scheduled_deletion_at', type: 'timestamp', nullable: true })
  @Index()
  scheduledDeletionAt?: Date;

  @OneToMany(() => ExtractedFieldEntity, (field) => field.document, {
    cascade: true,
  })
  extractedFields: ExtractedFieldEntity[];
}
