import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMAdapterService } from './anythingllm-adapter.service';
import { AnythingLLMWorkspaceModule } from '../workspace/anythingllm-workspace.module';
import { AnythingLLMDocumentModule } from '../document/anythingllm-document.module';
import { AnythingLLMThreadModule } from '../thread/anythingllm-thread.module';
import { ThreadScopedChatModule } from './thread-scoped-chat.module';
import { AnythingLLMProvisioningModule } from '../provisioning/anythingllm-provisioning.module';

/**
 * AnythingLLM Adapter Module
 *
 * Provides high-level adapter interface for AnythingLLM integration.
 */
@Module({
  imports: [
    AnythingLLMWorkspaceModule,
    AnythingLLMDocumentModule,
    AnythingLLMThreadModule,
    ThreadScopedChatModule,
    forwardRef(() => AnythingLLMProvisioningModule),
  ],
  providers: [AnythingLLMAdapterService],
  exports: [AnythingLLMAdapterService],
})
export class AnythingLLMAdapterModule {}

