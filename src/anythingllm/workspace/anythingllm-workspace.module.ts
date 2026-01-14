import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMWorkspaceService } from './anythingllm-workspace.service';
import { AnythingLLMWorkspaceController } from './anythingllm-workspace.controller';
import { AnythingLLMModule } from '../anythingllm.module';
import { AnythingLLMOrchestratorModule } from '../../anythingllm-orchestrator/module';
import { AuthModule } from '../../auth/auth.module';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMThreadModule } from '../thread/anythingllm-thread.module';
import { AnythingLLMProvisioningModule } from '../provisioning/anythingllm-provisioning.module';

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
    forwardRef(() => AuthModule), // For JWT strategy - use forwardRef to avoid circular dependency
    forwardRef(() => AnythingLLMThreadModule), // Use forwardRef to avoid potential circular dependency
    forwardRef(() => AnythingLLMProvisioningModule), // For thread recording - use forwardRef to avoid circular dependency
  ],
  controllers: [AnythingLLMWorkspaceController],
  providers: [AnythingLLMWorkspaceService, AnythingLLMRegistryClient],
  exports: [AnythingLLMWorkspaceService],
})
export class AnythingLLMWorkspaceModule {}
