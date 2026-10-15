import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Inbox } from './entities/inbox.entity';

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(Inbox)
    private readonly inboxRepository: Repository<Inbox>,
  ) {}

  async store(input: {
    messageId: string;
    type: string;
    payload: Record<string, any>;
  }): Promise<void> {
    await this.inboxRepository
      .createQueryBuilder()
      .insert()
      .into(Inbox)
      .values({
        messageId: input.messageId,
        type: input.type,
        payload: input.payload,
      })
      .orIgnore()
      .execute();
  }

  async claimPending(options: {
    take: number;
    maxAttempts: number;
    manager: EntityManager;
  }): Promise<Inbox[]> {
    return options.manager
      .createQueryBuilder(Inbox, 'inbox')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where('inbox.status = :status', { status: 'pending' })
      .andWhere('inbox.attempts < :maxAttempts', {
        maxAttempts: options.maxAttempts,
      })
      .orderBy('inbox.createdAt', 'ASC')
      .take(options.take)
      .getMany();
  }

  async markProcessed(id: number, manager: EntityManager): Promise<void> {
    await manager.getRepository(Inbox).update(id, { status: 'processed' });
  }

  async recordFailure(
    row: Pick<Inbox, 'id' | 'attempts'>,
    error: unknown,
    options: { maxAttempts: number },
    manager: EntityManager,
  ): Promise<void> {
    const attempts = row.attempts + 1;
    const status = attempts >= options.maxAttempts ? 'failed' : 'pending';
    const lastError = error instanceof Error ? error.message : String(error);
    await manager
      .getRepository(Inbox)
      .update(row.id, { attempts, status, lastError });
  }

  async markFailed(
    id: number,
    lastError: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager
      .getRepository(Inbox)
      .update(id, { status: 'failed', lastError });
  }
}
