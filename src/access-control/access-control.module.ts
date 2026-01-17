import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessGrantEntity } from './infrastructure/persistence/relational/entities/access-grant.entity';
import { AccessRequestEntity } from './infrastructure/persistence/relational/entities/access-request.entity';
import { AccessGrantRepository } from './domain/repositories/access-grant.repository.port';
import { AccessGrantRelationalRepository } from './infrastructure/persistence/relational/repositories/access-grant.repository';
import { AccessRequestRelationalRepository } from './infrastructure/persistence/relational/repositories/access-request.repository';
import { AccessGrantDomainService } from './domain/services/access-grant.domain.service';
import { AccessRequestDomainService } from './domain/services/access-request.domain.service';
import { AccessControlService } from './access-control.service';
import { AccessControlController } from './access-control.controller';
import { AccessRequestController } from './access-request.controller';
import { DocumentProcessingModule } from '../document-processing/document-processing.module';
import { RelationalManagerPersistenceModule } from '../managers/infrastructure/persistence/relational/relational-persistence.module';
import { ManagerRepositoryPort } from '../managers/domain/repositories/manager.repository.port';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessGrantEntity, AccessRequestEntity]),
    forwardRef(() => DocumentProcessingModule),
    RelationalManagerPersistenceModule,
    forwardRef(() => UsersModule), // SYSTEM-100: forwardRef to break circular dependency
  ],
  providers: [
    {
      provide: AccessGrantRepository,
      useClass: AccessGrantRelationalRepository,
    },
    {
      provide: 'AccessRequestRepository',
      useClass: AccessRequestRelationalRepository,
    },
    {
      provide: 'ManagerRepositoryPort',
      useExisting: ManagerRepositoryPort,
    },
    AccessGrantDomainService,
    AccessRequestDomainService,
    AccessControlService,
  ],
  controllers: [AccessControlController, AccessRequestController],
  exports: [
    AccessGrantRepository,
    AccessGrantDomainService,
    AccessRequestDomainService,
    AccessControlService,
  ],
})
export class AccessControlModule {}
