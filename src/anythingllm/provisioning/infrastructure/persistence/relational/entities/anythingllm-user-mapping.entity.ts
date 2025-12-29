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
 * AnythingLLM User Mapping Entity
 *
 * Maps Keystone users to AnythingLLM users and workspaces.
 * Stores the relationship between Keystone user IDs, AnythingLLM user IDs, and workspace slugs.
 */
@Entity({
  name: 'anythingllm_user_mappings',
})
export class AnythingLLMUserMappingEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    name: 'keystone_user_id',
    type: 'varchar',
    length: 255,
    unique: true,
    nullable: false,
  })
  @Index('IDX_anythingllm_user_mappings_keystone_user_id', { unique: true })
  keystoneUserId: string;

  @Column({ name: 'anythingllm_user_id', type: 'integer', nullable: false })
  anythingllmUserId: number;

  @Column({
    name: 'workspace_slug',
    type: 'varchar',
    length: 255,
    nullable: false,
  })
  @Index('IDX_anythingllm_user_mappings_workspace_slug')
  workspaceSlug: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
