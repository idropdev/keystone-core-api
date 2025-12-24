import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessGrantEntity } from './infrastructure/persistence/relational/entities/access-grant.entity';
import { AccessGrantRepository } from './domain/repositories/access-grant.repository.port';
import { AccessGrantRelationalRepository } from './infrastructure/persistence/relational/repositories/access-grant.repository';

@Module({
  imports: [TypeOrmModule.forFeature([AccessGrantEntity])],
  providers: [
    {
      provide: AccessGrantRepository,
      useClass: AccessGrantRelationalRepository,
    },
  ],
  exports: [AccessGrantRepository],
})
export class AccessControlModule {}

