import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnythingLLMUserMappingEntity } from './entities/anythingllm-user-mapping.entity';
import { AnythingLLMUserThreadEntity } from './entities/anythingllm-user-thread.entity';
import { DocumentAnythingLLMPathEntity } from './entities/document-anythingllm-path.entity';
import { AnythingLLMUserMappingRepository } from '../repositories/anythingllm-user-mapping.repository';
import { AnythingLLMUserMappingRelationalRepository } from '../repositories/anythingllm-user-mapping.repository';
import { AnythingLLMUserThreadRepository } from '../repositories/anythingllm-user-thread.repository';
import { AnythingLLMUserThreadRelationalRepository } from '../repositories/anythingllm-user-thread.repository';
import { DocumentAnythingLLMPathRepository } from '../repositories/document-anythingllm-path.repository';
import { DocumentAnythingLLMPathRelationalRepository } from '../repositories/document-anythingllm-path.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnythingLLMUserMappingEntity,
      AnythingLLMUserThreadEntity,
      DocumentAnythingLLMPathEntity,
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
    {
      provide: DocumentAnythingLLMPathRepository,
      useClass: DocumentAnythingLLMPathRelationalRepository,
    },
  ],
  exports: [
    AnythingLLMUserMappingRepository,
    AnythingLLMUserThreadRepository,
    DocumentAnythingLLMPathRepository,
  ],
})
export class RelationalAnythingLLMProvisioningPersistenceModule {}
