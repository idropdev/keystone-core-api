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
import { UserEntity } from '../../../../../users/infrastructure/persistence/relational/entities/user.entity';

@Entity({
  name: 'manager_invitations',
})
export class ManagerInvitationEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  email: string;

  // Manager identity fields (set at invitation time)
  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 255, nullable: true })
  legalName?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  address?: string;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  @Column({ name: 'phone_number', type: 'varchar', length: 50, nullable: true })
  phoneNumber?: string;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'invited_by_admin_id' })
  invitedByAdmin: UserEntity;

  @Column({ name: 'invited_by_admin_id' })
  @Index()
  invitedByAdminId: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  @Index()
  token: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  @Index()
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt?: Date;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending',
  })
  @Index()
  status: 'pending' | 'accepted' | 'expired' | 'revoked';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
