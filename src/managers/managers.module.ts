import { Module, forwardRef } from '@nestjs/common';
import { RelationalManagerPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ManagerOnboardingDomainService } from './domain/services/manager-onboarding.domain.service';
import { ManagerProfileDomainService } from './domain/services/manager-profile.domain.service';
import { AdminManagersController } from './controllers/admin-managers.controller';
import { ManagerOnboardingController } from './controllers/manager-onboarding.controller';
import { ManagersController } from './controllers/managers.controller';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { ManagerInvitationRepositoryPort } from './domain/repositories/manager-invitation.repository.port';
import { ManagerRepositoryPort } from './domain/repositories/manager.repository.port';

// NOTE: Managers are currently only supported in relational databases
// TODO: Add document database support if needed in the future
@Module({
  imports: [
    RelationalManagerPersistenceModule,
    forwardRef(() => UsersModule),
    AuditModule,
  ],
  controllers: [
    AdminManagersController,
    ManagerOnboardingController,
    ManagersController,
  ],
  providers: [
    ManagerOnboardingDomainService,
    ManagerProfileDomainService,
    {
      provide: 'ManagerInvitationRepositoryPort',
      useExisting: ManagerInvitationRepositoryPort,
    },
    {
      provide: 'ManagerRepositoryPort',
      useExisting: ManagerRepositoryPort,
    },
  ],
  exports: [
    RelationalManagerPersistenceModule,
    ManagerOnboardingDomainService,
    ManagerProfileDomainService,
  ],
})
export class ManagersModule {}
