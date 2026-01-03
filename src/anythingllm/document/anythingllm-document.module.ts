import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMDocumentService } from './anythingllm-document.service';
import { AnythingLLMModule } from '../anythingllm.module';

/**
 * AnythingLLM Document Module
 *
 * Provides document management functionality for AnythingLLM integration.
 */
@Module({
  imports: [forwardRef(() => AnythingLLMModule)],
  providers: [AnythingLLMDocumentService],
  exports: [AnythingLLMDocumentService],
})
export class AnythingLLMDocumentModule {}

