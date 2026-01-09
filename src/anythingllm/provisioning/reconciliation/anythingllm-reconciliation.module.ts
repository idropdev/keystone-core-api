import { Module } from '@nestjs/common';
import { AnythingLLMOrchestratorModule } from '../../../anythingllm-orchestrator/module';
import { AnythingLLMProvisioningPersistenceModule } from '../infrastructure/persistence/persistence.module';
import { AuthModule } from '../../../auth/auth.module';
import { AnythingLLMReconciliationService } from './anythingllm-reconciliation.service';
import { AnythingLLMReconciliationController } from './anythingllm-reconciliation.controller';

/**
 * AnythingLLM Reconciliation Module
 *
 * Provides reconciliation functionality to detect and fix inconsistencies
 * between Keystone and AnythingLLM:
 * - Orphaned mappings
 * - Orphaned AnythingLLM users
 * - Users without workspace assignments
 *
 * All operations use delegated tokens (HS256) with admin context.
 */
@Module({
  imports: [
    AnythingLLMOrchestratorModule, // For delegated token issuance
    AnythingLLMProvisioningPersistenceModule, // For mapping repository
    AuthModule, // For JWT guards
  ],
  controllers: [AnythingLLMReconciliationController],
  providers: [AnythingLLMReconciliationService],
  exports: [AnythingLLMReconciliationService],
})
export class AnythingLLMReconciliationModule {}
