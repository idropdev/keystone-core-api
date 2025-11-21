import { Module } from '@nestjs/common';
import { AnythingLLMService } from './anythingllm.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [AnythingLLMService],
  exports: [AnythingLLMService],
})
export class AnythingLLMModule {}
