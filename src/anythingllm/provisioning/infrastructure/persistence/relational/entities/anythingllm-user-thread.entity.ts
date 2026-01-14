import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EntityRelationalHelper } from '../../../../../../utils/relational-entity-helper';

/**
 * AnythingLLM User Thread Entity
 *
 * Tracks threads created by Keystone users in AnythingLLM workspaces.
 * Maintains a record of all chat threads for audit and reference purposes.
 */
@Entity({
  name: 'anythingllm_user_threads',
})
export class AnythingLLMUserThreadEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    name: 'keystone_user_id',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  @Index('IDX_anythingllm_user_threads_keystone_user_id')
  keystoneUserId: string;

  @Column({
    name: 'anythingllm_user_id',
    type: 'integer',
    nullable: false,
  })
  @Index('IDX_anythingllm_user_threads_anythingllm_user_id')
  anythingllmUserId: number;

  @Column({
    name: 'workspace_slug',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  @Index('IDX_anythingllm_user_threads_workspace_slug')
  workspaceSlug: string;

  @Column({
    name: 'thread_slug',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  @Index('IDX_anythingllm_user_threads_thread_slug', { unique: true })
  threadSlug: string;

  @Column({
    name: 'thread_name',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  threadName: string | null;

  @Column({
    name: 'workspace_id',
    type: 'integer',
    nullable: true,
  })
  workspaceId: number | null;

  @Column({
    name: 'message_count',
    type: 'integer',
    nullable: false,
    default: 0,
  })
  messageCount: number;

  @Column({
    name: 'last_message_at',
    type: 'timestamp',
    nullable: true,
  })
  @Index('IDX_anythingllm_user_threads_last_message_at')
  lastMessageAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({
    name: 'deleted_at',
    type: 'timestamp',
    nullable: true,
  })
  @Index('IDX_anythingllm_user_threads_deleted_at')
  deletedAt: Date | null;
}
