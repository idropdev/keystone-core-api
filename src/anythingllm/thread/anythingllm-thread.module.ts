import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMThreadService } from './anythingllm-thread.service';
import { AnythingLLMModule } from '../anythingllm.module';
import { AnythingLLMOrchestratorModule } from '../../anythingllm-orchestrator/module';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMProvisioningModule } from '../provisioning/anythingllm-provisioning.module';

/**
 * AnythingLLM Thread Module
 *
 * Provides thread management and chat functionality for AnythingLLM integration.
 */
@Module({
  imports: [
    forwardRef(() => AnythingLLMModule),
    AnythingLLMOrchestratorModule,
    forwardRef(() => AnythingLLMProvisioningModule),
  ],
  providers: [AnythingLLMThreadService, AnythingLLMRegistryClient],
  exports: [AnythingLLMThreadService],
})
export class AnythingLLMThreadModule {}
