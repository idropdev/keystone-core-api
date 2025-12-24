import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagerOrganizationEntity } from './entities/manager-organization.entity';
import { ManagerInstanceEntity } from './entities/manager-instance.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ManagerOrganizationEntity, ManagerInstanceEntity]),
  ],
  exports: [TypeOrmModule],
})
export class RelationalManagerPersistenceModule {}

