import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
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
  name: 'managers',
})
export class ManagerEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => UserEntity, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'user_id' })
  @Index()
  userId: number;

  // Identity (Required for uniqueness)
  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName: string;

  @Column({ name: 'legal_name', type: 'varchar', length: 255, nullable: true })
  legalName?: string;

  // Location (at least one required)
  @Column({ type: 'varchar', length: 500, nullable: true })
  address?: string;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude?: number;

  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude?: number;

  // Contact & Metadata
  @Column({ name: 'phone_number', type: 'varchar', length: 50, nullable: true })
  phoneNumber?: string;

  @Column({
    name: 'operating_hours',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  operatingHours?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  timezone?: string;

  // Verification (Manager-Level)
  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 50,
    default: 'pending',
  })
  @Index()
  verificationStatus: 'pending' | 'verified' | 'suspended';

  @Column({ name: 'verified_at', type: 'timestamp', nullable: true })
  verifiedAt?: Date;

  @Column({ name: 'verified_by_admin_id', nullable: true })
  verifiedByAdminId?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}
