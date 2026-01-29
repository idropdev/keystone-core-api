import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../utils/relational-entity-helper';

/**
 * Document AnythingLLM Path Entity
 *
 * Maps Keystone document UUIDs to AnythingLLM document paths within a workspace.
 * Keystone uses this mapping to translate documentIds -> documentPaths for scoped chat.
 */
@Entity({
  name: 'document_anythingllm_paths',
})
@Index('IDX_document_anythingllm_paths_document_workspace', [
  'documentId',
  'workspaceSlug',
])
export class DocumentAnythingLLMPathEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    name: 'document_id',
    type: 'uuid',
    nullable: false,
  })
  @Index('IDX_document_anythingllm_paths_document_id')
  documentId: string;

  @Column({
    name: 'workspace_slug',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  @Index('IDX_document_anythingllm_paths_workspace_slug')
  workspaceSlug: string;

  @Column({
    name: 'anythingllm_doc_path',
    type: 'varchar',
    length: 500,
    nullable: false,
  })
  anythingllmDocPath: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

