import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessGrantEntity } from './infrastructure/persistence/relational/entities/access-grant.entity';
import { AccessGrantRepository } from './domain/repositories/access-grant.repository.port';
import { AccessGrantRelationalRepository } from './infrastructure/persistence/relational/repositories/access-grant.repository';
import { AccessGrantDomainService } from './domain/services/access-grant.domain.service';
import { AccessControlService } from './access-control.service';
import { AccessControlController } from './access-control.controller';
import { DocumentProcessingModule } from '../document-processing/document-processing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccessGrantEntity]),
    forwardRef(() => DocumentProcessingModule), // Import to access DocumentRepositoryPort and DocumentAccessDomainService (forwardRef to break circular dependency)
  ],
  providers: [
    {
      provide: AccessGrantRepository,
      useClass: AccessGrantRelationalRepository,
    },
    AccessGrantDomainService,
    AccessControlService,
  ],
  controllers: [AccessControlController],
  exports: [AccessGrantRepository, AccessGrantDomainService, AccessControlService],
})
export class AccessControlModule {}

