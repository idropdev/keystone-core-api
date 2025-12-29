import { Module } from '@nestjs/common';
import { AnythingLLMAdminModule } from '../admin/anythingllm-admin.module';
import { AuditModule } from '../../audit/audit.module';
import { AnythingLLMUserProvisioningService } from './anythingllm-user-provisioning.service';
import { WorkspaceMapperService } from './domain/workspace-mapper.service';
import { AnythingLLMProvisioningPersistenceModule } from './infrastructure/persistence/persistence.module';

/**
 * AnythingLLM Provisioning Module
 *
 * Provides automatic user provisioning from Keystone to AnythingLLM.
 * Handles user creation, workspace assignment, and suspension sync.
 *
 * Note: Currently only works with relational databases. Document databases are not supported yet.
 * The mapping repository is optional and will be null when using document databases.
 */
@Module({
  imports: [
    AnythingLLMAdminModule,
    AuditModule,
    AnythingLLMProvisioningPersistenceModule,
  ],
  providers: [AnythingLLMUserProvisioningService, WorkspaceMapperService],
  exports: [AnythingLLMUserProvisioningService],
})
export class AnythingLLMProvisioningModule {}
