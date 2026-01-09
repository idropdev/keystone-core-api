import { Module, forwardRef } from '@nestjs/common';
import { AnythingLLMPolicyService } from './service';
import { AccessControlModule } from '../access-control/access-control.module';
import { UsersModule } from '../users/users.module';
import { AnythingLLMProvisioningPersistenceModule } from '../anythingllm/provisioning/infrastructure/persistence/persistence.module';

@Module({
  imports: [
    forwardRef(() => AccessControlModule),
    forwardRef(() => UsersModule),
    AnythingLLMProvisioningPersistenceModule,
  ],
  providers: [AnythingLLMPolicyService],
  exports: [AnythingLLMPolicyService],
})
export class AnythingLLMPolicyModule {}
