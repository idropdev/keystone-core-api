import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnythingLLMUserMappingEntity } from './entities/anythingllm-user-mapping.entity';
import { AnythingLLMUserThreadEntity } from './entities/anythingllm-user-thread.entity';
import { AnythingLLMUserMappingRepository } from '../repositories/anythingllm-user-mapping.repository';
import { AnythingLLMUserMappingRelationalRepository } from '../repositories/anythingllm-user-mapping.repository';
import { AnythingLLMUserThreadRepository } from '../repositories/anythingllm-user-thread.repository';
import { AnythingLLMUserThreadRelationalRepository } from '../repositories/anythingllm-user-thread.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnythingLLMUserMappingEntity,
      AnythingLLMUserThreadEntity,
    ]),
  ],
  providers: [
    {
      provide: AnythingLLMUserMappingRepository,
      useClass: AnythingLLMUserMappingRelationalRepository,
    },
    {
      provide: AnythingLLMUserThreadRepository,
      useClass: AnythingLLMUserThreadRelationalRepository,
    },
  ],
  exports: [AnythingLLMUserMappingRepository, AnythingLLMUserThreadRepository],
})
export class RelationalAnythingLLMProvisioningPersistenceModule {}
