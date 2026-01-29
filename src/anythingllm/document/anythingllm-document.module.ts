import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMDocumentService } from './anythingllm-document.service';
import { AnythingLLMDocumentController } from './anythingllm-document.controller';
import { AnythingLLMModule } from '../anythingllm.module';
import { AnythingLLMOrchestratorModule } from '../../anythingllm-orchestrator/module';
import { AuthModule } from '../../auth/auth.module';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { RelationalAnythingLLMProvisioningPersistenceModule } from '../provisioning/infrastructure/persistence/relational/relational-persistence.module';

/**
 * AnythingLLM Document Module
 *
 * Provides document management functionality for AnythingLLM integration.
 * Supports both user JWT (delegated token) and service identity authentication.
 */
@Module({
  imports: [
    forwardRef(() => AnythingLLMModule),
    AnythingLLMOrchestratorModule,
    AuthModule, // For JWT strategy
    RelationalAnythingLLMProvisioningPersistenceModule,
  ],
  controllers: [AnythingLLMDocumentController],
  providers: [AnythingLLMDocumentService, AnythingLLMRegistryClient],
  exports: [AnythingLLMDocumentService],
})
export class AnythingLLMDocumentModule {}
