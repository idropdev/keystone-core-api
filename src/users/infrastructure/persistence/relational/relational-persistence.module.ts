import { Module } from '@nestjs/common';
import { UserRepository } from '../user.repository';
import { UsersRelationalRepository } from './repositories/user.repository';
import { UserManagerAssignmentRepository } from '../user-manager-assignment.repository';
import { UserManagerAssignmentRelationalRepository } from './repositories/user-manager-assignment.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entities/user.entity';
import { UserManagerAssignmentEntity } from './entities/user-manager-assignment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, UserManagerAssignmentEntity]),
  ],
  providers: [
    {
      provide: UserRepository,
      useClass: UsersRelationalRepository,
    },
    {
      provide: UserManagerAssignmentRepository,
      useClass: UserManagerAssignmentRelationalRepository,
    },
  ],
  exports: [UserRepository, UserManagerAssignmentRepository],
})
export class RelationalUserPersistenceModule {}
