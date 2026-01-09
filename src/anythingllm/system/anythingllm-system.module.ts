import { Module } from '@nestjs/common';
import { AnythingLLMModule } from '../anythingllm.module';
import { AnythingLLMSystemController } from './anythingllm-system.controller';
import { AnythingLLMSystemService } from './anythingllm-system.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMOrchestratorModule } from '../../anythingllm-orchestrator/module';
import { AuthModule } from '../../auth/auth.module';

/**
 * AnythingLLM System Module
 *
 * Provides system proxy endpoints for AnythingLLM operations.
 * Supports both user JWT (delegated token) and service identity authentication.
 */
@Module({
  imports: [
    AnythingLLMModule,
    AnythingLLMOrchestratorModule,
    AuthModule, // For JWT strategy
  ],
  controllers: [AnythingLLMSystemController],
  providers: [AnythingLLMSystemService, AnythingLLMRegistryClient],
  exports: [AnythingLLMSystemService],
})
export class AnythingLLMSystemModule {}
