import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RevocationRequestEntity } from './infrastructure/persistence/relational/entities/revocation-request.entity';
import { RevocationRequestRepositoryPort } from './domain/repositories/revocation-request.repository.port';
import { RevocationRequestRelationalRepository } from './infrastructure/persistence/relational/repositories/revocation-request.repository';
import { RevocationRequestDomainService } from './domain/services/revocation-request.domain.service';
import { RevocationService } from './revocation.service';
import { RevocationController } from './revocation.controller';
import { DocumentProcessingModule } from '../document-processing/document-processing.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // Database
    TypeOrmModule.forFeature([RevocationRequestEntity]),

    // Dependencies (forwardRef to break circular dependencies)
    forwardRef(() => DocumentProcessingModule), // For DocumentRepositoryPort and DocumentAccessDomainService
    forwardRef(() => AccessControlModule), // For AccessGrantDomainService
    AuditModule, // For AuditService
  ],
  providers: [
    {
      provide: RevocationRequestRepositoryPort,
      useClass: RevocationRequestRelationalRepository,
    },
    RevocationRequestDomainService,
    RevocationService,
  ],
  controllers: [RevocationController],
  exports: [
    RevocationRequestRepositoryPort,
    RevocationRequestDomainService,
    RevocationService,
  ],
})
export class RevocationModule {}

