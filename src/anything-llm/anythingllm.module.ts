import { Module } from '@nestjs/common';
import { AnythingLLMService } from './anythingllm.service';

@Module({
  providers: [AnythingLLMService],
  exports: [AnythingLLMService],
})
export class AnythingLLMModule {}
