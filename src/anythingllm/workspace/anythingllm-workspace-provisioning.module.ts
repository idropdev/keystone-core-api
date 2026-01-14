import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMWorkspaceProvisioningService } from './anythingllm-workspace-provisioning.service';
import { AnythingLLMWorkspaceModule } from './anythingllm-workspace.module';
import { AnythingLLMProvisioningModule } from '../provisioning/anythingllm-provisioning.module';

/**
 * AnythingLLM Workspace Provisioning Module
 *
 * Provides workspace provisioning functionality with idempotency.
 */
@Module({
  imports: [
    AnythingLLMWorkspaceModule,
    forwardRef(() => AnythingLLMProvisioningModule),
  ],
  providers: [AnythingLLMWorkspaceProvisioningService],
  exports: [AnythingLLMWorkspaceProvisioningService],
})
export class AnythingLLMWorkspaceProvisioningModule {}
