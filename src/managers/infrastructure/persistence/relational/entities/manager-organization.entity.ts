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
  name: 'manager_organizations',
})
export class ManagerOrganizationEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  @Index()
  name: string;

  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 50,
    default: 'pending',
  })
  @Index()
  verificationStatus: 'verified' | 'pending' | 'rejected';

  @Column({ name: 'verified_at', type: 'timestamp', nullable: true })
  verifiedAt?: Date;

  @ManyToOne(() => UserEntity, { nullable: true })
  @JoinColumn({ name: 'verified_by' })
  verifiedBy?: UserEntity;

  @Column({ name: 'verified_by', nullable: true })
  verifiedById?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}
