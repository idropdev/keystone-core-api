import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnythingLLMUserMappingEntity } from './entities/anythingllm-user-mapping.entity';
import { AnythingLLMUserMappingRepository } from '../repositories/anythingllm-user-mapping.repository';
import { AnythingLLMUserMappingRelationalRepository } from '../repositories/anythingllm-user-mapping.repository';

@Module({
  imports: [TypeOrmModule.forFeature([AnythingLLMUserMappingEntity])],
  providers: [
    {
      provide: AnythingLLMUserMappingRepository,
      useClass: AnythingLLMUserMappingRelationalRepository,
    },
  ],
  exports: [AnythingLLMUserMappingRepository],
})
export class RelationalAnythingLLMProvisioningPersistenceModule {}
