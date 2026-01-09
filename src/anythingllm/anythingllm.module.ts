import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import anythingllmConfig from './config/anythingllm.config';
import { AnythingLLMServiceIdentityService } from './services/anythingllm-service-identity.service';
import { AnythingLLMClientService } from './services/anythingllm-client.service';
import { AnythingLLMHealthService } from './services/anythingllm-health.service';
import { AnythingLLMAuthDelegationModule } from '../anythingllm-auth-delegation/module';

@Module({
  imports: [
    ConfigModule.forFeature(anythingllmConfig),
    AnythingLLMAuthDelegationModule, // Required for delegated tokens (HS256) in client service
  ],
  providers: [
    AnythingLLMServiceIdentityService,
    AnythingLLMClientService,
    AnythingLLMHealthService,
  ],
  exports: [
    AnythingLLMClientService,
    AnythingLLMHealthService,
    AnythingLLMServiceIdentityService,
  ],
})
export class AnythingLLMModule {}
