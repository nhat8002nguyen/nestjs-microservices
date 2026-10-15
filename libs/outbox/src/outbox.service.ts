import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Outbox } from './entities/outbox.entity';

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(Outbox)
    private readonly outboxRepository: Repository<Outbox>,
  ) {}

  async claimPending(options: {
    target: string;
    take: number;
    manager: EntityManager;
  }): Promise<Outbox[]> {
    return options.manager
      .createQueryBuilder(Outbox, 'outbox')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where('outbox.target = :target', { target: options.target })
      .andWhere('outbox.status = :status', { status: 'pending' })
      .orderBy('outbox.createdAt', 'ASC')
      .take(options.take)
      .getMany();
  }

  async markAsProcessed(id: number, manager?: EntityManager): Promise<void> {
    const repository = manager
      ? manager.getRepository(Outbox)
      : this.outboxRepository;
    await repository.update(id, { status: 'processed' });
  }
}
