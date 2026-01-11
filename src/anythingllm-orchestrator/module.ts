import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMOrchestratorService } from './service';
import { AnythingLLMPolicyModule } from '../anythingllm-policy/module';
import { AnythingLLMAuthDelegationModule } from '../anythingllm-auth-delegation/module';
import { AnythingLLMModule } from '../anythingllm/anythingllm.module';

@Module({
  imports: [
    forwardRef(() => AnythingLLMPolicyModule),
    AnythingLLMAuthDelegationModule,
    forwardRef(() => AnythingLLMModule),
  ],
  providers: [AnythingLLMOrchestratorService],
  exports: [AnythingLLMOrchestratorService],
})
export class AnythingLLMOrchestratorModule {}
