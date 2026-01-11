import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnythingLLMUserThreadEntity } from '../entities/anythingllm-user-thread.entity';

export abstract class AnythingLLMUserThreadRepository {
  abstract create(data: {
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceSlug: string;
    threadSlug: string;
    threadName?: string;
    workspaceId?: number;
  }): Promise<AnythingLLMUserThreadEntity>;

  abstract findByThreadSlug(
    threadSlug: string,
  ): Promise<AnythingLLMUserThreadEntity | null>;

  abstract findByKeystoneUserId(
    keystoneUserId: string,
  ): Promise<AnythingLLMUserThreadEntity[]>;

  abstract findByWorkspaceSlug(
    workspaceSlug: string,
  ): Promise<AnythingLLMUserThreadEntity[]>;

  abstract updateMessageCount(
    threadSlug: string,
    messageCount: number,
    lastMessageAt: Date,
  ): Promise<void>;

  abstract softDelete(threadSlug: string): Promise<void>;
}

@Injectable()
export class AnythingLLMUserThreadRelationalRepository
  implements AnythingLLMUserThreadRepository
{
  constructor(
    @InjectRepository(AnythingLLMUserThreadEntity)
    private readonly repository: Repository<AnythingLLMUserThreadEntity>,
  ) {}

  async create(data: {
    keystoneUserId: string;
    anythingllmUserId: number;
    workspaceSlug: string;
    threadSlug: string;
    threadName?: string;
    workspaceId?: number;
  }): Promise<AnythingLLMUserThreadEntity> {
    const entity = this.repository.create({
      keystoneUserId: data.keystoneUserId,
      anythingllmUserId: data.anythingllmUserId,
      workspaceSlug: data.workspaceSlug,
      threadSlug: data.threadSlug,
      threadName: data.threadName || null,
      workspaceId: data.workspaceId || null,
      messageCount: 0,
      lastMessageAt: null,
      deletedAt: null,
    });

    return await this.repository.save(entity);
  }

  async findByThreadSlug(
    threadSlug: string,
  ): Promise<AnythingLLMUserThreadEntity | null> {
    return await this.repository.findOne({
      where: { threadSlug, deletedAt: null },
    });
  }

  async findByKeystoneUserId(
    keystoneUserId: string,
  ): Promise<AnythingLLMUserThreadEntity[]> {
    return await this.repository.find({
      where: { keystoneUserId, deletedAt: null },
      order: { lastMessageAt: 'DESC', createdAt: 'DESC' },
    });
  }

  async findByWorkspaceSlug(
    workspaceSlug: string,
  ): Promise<AnythingLLMUserThreadEntity[]> {
    return await this.repository.find({
      where: { workspaceSlug, deletedAt: null },
      order: { lastMessageAt: 'DESC', createdAt: 'DESC' },
    });
  }

  async updateMessageCount(
    threadSlug: string,
    messageCount: number,
    lastMessageAt: Date,
  ): Promise<void> {
    await this.repository.update(
      { threadSlug },
      { messageCount, lastMessageAt },
    );
  }

  async softDelete(threadSlug: string): Promise<void> {
    await this.repository.update({ threadSlug }, { deletedAt: new Date() });
  }
}
