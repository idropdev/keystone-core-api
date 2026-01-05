import { Module } from '@nestjs/common';
import { AnythingLLMModule } from '../anythingllm.module';
import { AnythingLLMSystemController } from './anythingllm-system.controller';
import { AnythingLLMSystemService } from './anythingllm-system.service';
import { AnythingLLMRegistryClient } from '../registry/anythingllm-registry-client';
import { AnythingLLMOrchestratorModule } from '../../anythingllm-orchestrator/module';
import { AuthModule } from '../../auth/auth.module';

/**
 * AnythingLLM System Module
 *
 * Provides system proxy endpoints for AnythingLLM operations.
 * Supports both user JWT (delegated token) and service identity authentication.
 */
@Module({
  imports: [
    AnythingLLMModule,
    AnythingLLMOrchestratorModule,
    AuthModule, // For JWT strategy
  ],
  controllers: [AnythingLLMSystemController],
  providers: [
    AnythingLLMSystemService,
    AnythingLLMRegistryClient,
  ],
  exports: [AnythingLLMSystemService],
})
export class AnythingLLMSystemModule {
  constructor() {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4b3ccba3-55b0-467b-8ddb-33cba3067360',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'anythingllm-system.module.ts:28',message:'AnythingLLMSystemModule initialized',data:{moduleName:'AnythingLLMSystemModule'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
  }
}

