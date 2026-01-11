import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMPolicyService } from './service';
import { AccessControlModule } from '../access-control/access-control.module';
import { UsersModule } from '../users/users.module';
import { AnythingLLMProvisioningPersistenceModule } from '../anythingllm/provisioning/infrastructure/persistence/persistence.module';
import { AnythingLLMOrchestratorModule } from '../anythingllm-orchestrator/module';

@Module({
  imports: [
    forwardRef(() => AccessControlModule),
    forwardRef(() => UsersModule),
    AnythingLLMProvisioningPersistenceModule,
    forwardRef(() => AnythingLLMOrchestratorModule),
  ],
  providers: [AnythingLLMPolicyService],
  exports: [AnythingLLMPolicyService],
})
export class AnythingLLMPolicyModule {}
