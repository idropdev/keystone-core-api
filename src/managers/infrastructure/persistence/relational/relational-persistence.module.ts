import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagerEntity } from './entities/manager.entity';
import { ManagerInvitationEntity } from './entities/manager-invitation.entity';
import { ManagerInvitationRelationalRepository } from './repositories/manager-invitation.repository';
import { ManagerInvitationRepositoryPort } from '../../../domain/repositories/manager-invitation.repository.port';
import { ManagerRelationalRepository } from './repositories/manager.repository';
import { ManagerRepositoryPort } from '../../../domain/repositories/manager.repository.port';

@Module({
  imports: [TypeOrmModule.forFeature([ManagerEntity, ManagerInvitationEntity])],
  providers: [
    ManagerInvitationRelationalRepository,
    {
      provide: ManagerInvitationRepositoryPort,
      useClass: ManagerInvitationRelationalRepository,
    },
    ManagerRelationalRepository,
    {
      provide: ManagerRepositoryPort,
      useClass: ManagerRelationalRepository,
    },
  ],
  exports: [
    TypeOrmModule,
    ManagerInvitationRepositoryPort,
    ManagerRepositoryPort,
  ],
})
export class RelationalManagerPersistenceModule {}
