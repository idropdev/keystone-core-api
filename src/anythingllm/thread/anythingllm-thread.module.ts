import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMThreadService } from './anythingllm-thread.service';
import { AnythingLLMModule } from '../anythingllm.module';

/**
 * AnythingLLM Thread Module
 *
 * Provides thread management and chat functionality for AnythingLLM integration.
 */
@Module({
  imports: [forwardRef(() => AnythingLLMModule)],
  providers: [AnythingLLMThreadService],
  exports: [AnythingLLMThreadService],
})
export class AnythingLLMThreadModule {}
