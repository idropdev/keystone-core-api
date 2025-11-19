import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { DocumentEntity } from './document.entity';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({ name: 'extracted_fields' })
export class ExtractedFieldEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DocumentEntity, (doc) => doc.extractedFields, {
    nullable: false,
  })
  @JoinColumn({ name: 'document_id' })
  @Index()
  document: DocumentEntity;

  @Column({ name: 'document_id' })
  documentId: string;

  @Column({ name: 'field_key', type: 'varchar', length: 100 })
  @Index()
  fieldKey: string;

  @Column({ name: 'field_value', type: 'text' })
  fieldValue: string;

  @Column({ name: 'field_type', type: 'varchar', length: 50 })
  fieldType: string;

  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true })
  confidence?: number;

  @Column({ name: 'start_index', type: 'integer', nullable: true })
  startIndex?: number;

  @Column({ name: 'end_index', type: 'integer', nullable: true })
  endIndex?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
