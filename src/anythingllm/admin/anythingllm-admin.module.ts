import { Module } from '@nestjs/common';
import { AnythingLLMModule } from '../anythingllm.module';
import { AnythingLLMAdminController } from './anythingllm-admin.controller';
import { AnythingLLMAdminService } from './anythingllm-admin.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { ServiceIdentityGuard } from '../guards/service-identity.guard';
import { AnythingLLMOrchestratorModule } from '../../anythingllm-orchestrator/module';

/**
 * AnythingLLM Admin Module
 *
 * Provides admin proxy endpoints for AnythingLLM management.
 * All endpoints require service identity authentication.
 */
@Module({
  imports: [AnythingLLMModule, AnythingLLMOrchestratorModule],
  controllers: [AnythingLLMAdminController],
  providers: [
    AnythingLLMAdminService,
    AnythingLLMRegistryClient,
    ServiceIdentityGuard,
  ],
  exports: [AnythingLLMAdminService],
})
export class AnythingLLMAdminModule {}
