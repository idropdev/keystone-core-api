import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMAdminOversightService } from './anythingllm-admin-oversight.service';
import { AnythingLLMThreadModule } from '../thread/anythingllm-thread.module';
import { AnythingLLMAdminModule } from './anythingllm-admin.module';
import { AnythingLLMModule } from '../anythingllm.module';

/**
 * AnythingLLM Admin Oversight Module
 *
 * Provides admin oversight functionality for AnythingLLM integration.
 */
@Module({
  imports: [
    AnythingLLMThreadModule,
    forwardRef(() => AnythingLLMAdminModule),
    forwardRef(() => AnythingLLMModule),
  ],
  providers: [AnythingLLMAdminOversightService],
  exports: [AnythingLLMAdminOversightService],
})
export class AnythingLLMAdminOversightModule {}
