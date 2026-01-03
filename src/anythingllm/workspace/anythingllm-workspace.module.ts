import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMWorkspaceService } from './anythingllm-workspace.service';
import { AnythingLLMModule } from '../anythingllm.module';

/**
 * AnythingLLM Workspace Module
 *
 * Provides workspace management functionality for AnythingLLM integration.
 */
@Module({
  imports: [forwardRef(() => AnythingLLMModule)],
  providers: [AnythingLLMWorkspaceService],
  exports: [AnythingLLMWorkspaceService],
})
export class AnythingLLMWorkspaceModule {}

