import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMWorkspaceService } from './anythingllm-workspace.service';
import { AnythingLLMWorkspaceController } from './anythingllm-workspace.controller';
import { AnythingLLMModule } from '../anythingllm.module';
import { AnythingLLMOrchestratorModule } from '../../anythingllm-orchestrator/module';
import { AuthModule } from '../../auth/auth.module';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';

/**
 * AnythingLLM Workspace Module
 *
 * Provides workspace management functionality for AnythingLLM integration.
 * Supports both user JWT (delegated token) and service identity authentication.
 */
@Module({
  imports: [
    forwardRef(() => AnythingLLMModule),
    AnythingLLMOrchestratorModule,
    AuthModule, // For JWT strategy
  ],
  controllers: [AnythingLLMWorkspaceController],
  providers: [
    AnythingLLMWorkspaceService,
    AnythingLLMRegistryClient,
  ],
  exports: [AnythingLLMWorkspaceService],
})
export class AnythingLLMWorkspaceModule {}

