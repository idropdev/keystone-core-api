import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMVectorSearchService } from './anythingllm-vector-search.service';
import { AnythingLLMModule } from '../anythingllm.module';

/**
 * AnythingLLM Vector Search Module
 *
 * Provides vector search and OpenAI-compatible functionality for AnythingLLM integration.
 */
@Module({
  imports: [forwardRef(() => AnythingLLMModule)],
  providers: [AnythingLLMVectorSearchService],
  exports: [AnythingLLMVectorSearchService],
})
export class AnythingLLMVectorSearchModule {}

