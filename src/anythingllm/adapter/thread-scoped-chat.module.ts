import { Module } from '@nestjs/common';
import { ThreadScopedChatService } from './thread-scoped-chat.service';
import { AnythingLLMVectorSearchModule } from '../vector-search/anythingllm-vector-search.module';

/**
 * Thread-Scoped Chat Module
 *
 * Provides strict document scoping for thread conversations.
 */
@Module({
  imports: [AnythingLLMVectorSearchModule],
  providers: [ThreadScopedChatService],
  exports: [ThreadScopedChatService],
})
export class ThreadScopedChatModule {}





