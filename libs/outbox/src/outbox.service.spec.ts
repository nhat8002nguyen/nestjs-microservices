import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { Outbox } from './entities/outbox.entity';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  let service: OutboxService;
  let repository: { update: jest.Mock };

  beforeEach(async () => {
    repository = {
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        { provide: getRepositoryToken(Outbox), useValue: repository },
      ],
    }).compile();

    service = module.get(OutboxService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('claims pending messages for a target with SKIP LOCKED in createdAt order', async () => {
    const rows = [{ id: 1, status: 'pending' }];
    const getMany = jest.fn().mockResolvedValue(rows);
    const take = jest.fn().mockReturnValue({ getMany });
    const orderBy = jest.fn().mockReturnValue({ take });
    const andWhere = jest.fn().mockReturnValue({ orderBy });
    const where = jest.fn().mockReturnValue({ andWhere });
    const setOnLocked = jest.fn().mockReturnValue({ where });
    const setLock = jest.fn().mockReturnValue({ setOnLocked });
    const createQueryBuilder = jest.fn().mockReturnValue({ setLock });
    const manager = { createQueryBuilder } as unknown as EntityManager;

    const result = await service.claimPending({
      target: 'workflows-service',
      take: 1,
      manager,
    });

    expect(createQueryBuilder).toHaveBeenCalledWith(Outbox, 'outbox');
    expect(setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(where).toHaveBeenCalledWith('outbox.target = :target', {
      target: 'workflows-service',
    });
    expect(andWhere).toHaveBeenCalledWith('outbox.status = :status', {
      status: 'pending',
    });
    expect(orderBy).toHaveBeenCalledWith('outbox.createdAt', 'ASC');
    expect(take).toHaveBeenCalledWith(1);
    expect(result).toEqual(rows);
  });

  it('marks a message as processed', async () => {
    repository.update.mockResolvedValue(undefined);

    await service.markAsProcessed(7);

    expect(repository.update).toHaveBeenCalledWith(7, { status: 'processed' });
  });
});
