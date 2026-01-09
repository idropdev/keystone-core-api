import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnythingLLMUserMappingEntity } from '../relational/entities/anythingllm-user-mapping.entity';
import { NullableType } from '../../../../../utils/types/nullable.type';

/**
 * Repository abstract class for AnythingLLM user mappings
 *
 * Abstract class (not interface) to allow use as dependency injection token in NestJS
 */
export abstract class AnythingLLMUserMappingRepository {
  abstract create(data: {
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceSlug: string;
  }): Promise<AnythingLLMUserMappingEntity>;

  abstract findByKeystoneUserId(
    keystoneUserId: string,
  ): Promise<NullableType<AnythingLLMUserMappingEntity>>;

  abstract findByWorkspaceSlug(
    workspaceSlug: string,
  ): Promise<AnythingLLMUserMappingEntity[]>;

  abstract findAll(): Promise<AnythingLLMUserMappingEntity[]>;

  abstract findByAnythingLLMUserId(
    anythingllmUserId: number,
  ): Promise<NullableType<AnythingLLMUserMappingEntity>>;

  abstract delete(id: number): Promise<void>;
}

/**
 * Relational repository implementation for AnythingLLM user mappings
 */
@Injectable()
export class AnythingLLMUserMappingRelationalRepository
  implements AnythingLLMUserMappingRepository
{
  constructor(
    @InjectRepository(AnythingLLMUserMappingEntity)
    private readonly mappingRepository: Repository<AnythingLLMUserMappingEntity>,
  ) {}

  async create(data: {
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceSlug: string;
  }): Promise<AnythingLLMUserMappingEntity> {
    const entity = this.mappingRepository.create(data);
    return await this.mappingRepository.save(entity);
  }

  async findByKeystoneUserId(
    keystoneUserId: string,
  ): Promise<NullableType<AnythingLLMUserMappingEntity>> {
    return await this.mappingRepository.findOne({
      where: { keystoneUserId },
    });
  }

  async findByWorkspaceSlug(
    workspaceSlug: string,
  ): Promise<AnythingLLMUserMappingEntity[]> {
    return await this.mappingRepository.find({
      where: { workspaceSlug },
    });
  }

  async findAll(): Promise<AnythingLLMUserMappingEntity[]> {
    return await this.mappingRepository.find();
  }

  async findByAnythingLLMUserId(
    anythingllmUserId: number,
  ): Promise<NullableType<AnythingLLMUserMappingEntity>> {
    return await this.mappingRepository.findOne({
      where: { anythingllmUserId },
    });
  }

  async delete(id: number): Promise<void> {
    await this.mappingRepository.delete(id);
  }
}
