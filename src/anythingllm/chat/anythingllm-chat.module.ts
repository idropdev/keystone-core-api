import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AnythingLLMOrchestratorModule } from '../../anythingllm-orchestrator/module';
import { AccessControlModule } from '../../access-control/access-control.module';
import { RelationalAnythingLLMProvisioningPersistenceModule } from '../provisioning/infrastructure/persistence/relational/relational-persistence.module';
import { AnythingLLMChatController } from './anythingllm-chat.controller';
import { AnythingLLMChatService } from './anythingllm-chat.service';

@Module({
  imports: [
    AuthModule,
    AnythingLLMOrchestratorModule,
    AccessControlModule,
    RelationalAnythingLLMProvisioningPersistenceModule,
  ],
  controllers: [AnythingLLMChatController],
  providers: [AnythingLLMChatService],
  exports: [AnythingLLMChatService],
})
export class AnythingLLMChatModule {}
