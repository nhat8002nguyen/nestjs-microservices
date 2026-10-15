import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { Inbox } from './entities/inbox.entity';
import { InboxService } from './inbox.service';

describe('InboxService', () => {
  let service: InboxService;
  let queryBuilder: {
    insert: jest.Mock;
    into: jest.Mock;
    values: jest.Mock;
    orIgnore: jest.Mock;
    execute: jest.Mock;
  };
  let repository: {
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    queryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxService,
        { provide: getRepositoryToken(Inbox), useValue: repository },
      ],
    }).compile();

    service = module.get(InboxService);
  });

  it('store inserts a pending inbox row with ON CONFLICT DO NOTHING (.orIgnore)', async () => {
    const input = {
      messageId: 'outbox:1',
      type: 'workflows.create',
      payload: { name: 'wf', buildingId: 1 },
    };

    await service.store(input);

    expect(repository.createQueryBuilder).toHaveBeenCalled();
    expect(queryBuilder.insert).toHaveBeenCalled();
    expect(queryBuilder.into).toHaveBeenCalledWith(Inbox);
    expect(queryBuilder.values).toHaveBeenCalledWith(input);
    expect(queryBuilder.orIgnore).toHaveBeenCalled();
    expect(queryBuilder.execute).toHaveBeenCalled();
  });

  it('store rethrows database errors', async () => {
    queryBuilder.execute.mockRejectedValue(new Error('db down'));

    await expect(
      service.store({
        messageId: 'outbox:1',
        type: 'workflows.create',
        payload: {},
      }),
    ).rejects.toThrow('db down');
  });

  it('claimPending locks pending rows with SKIP LOCKED', async () => {
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
      take: 1,
      maxAttempts: 3,
      manager,
    });

    expect(createQueryBuilder).toHaveBeenCalledWith(Inbox, 'inbox');
    expect(setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(setOnLocked).toHaveBeenCalledWith('skip_locked');
    expect(where).toHaveBeenCalledWith('inbox.status = :status', {
      status: 'pending',
    });
    expect(andWhere).toHaveBeenCalledWith('inbox.attempts < :maxAttempts', {
      maxAttempts: 3,
    });
    expect(orderBy).toHaveBeenCalledWith('inbox.createdAt', 'ASC');
    expect(take).toHaveBeenCalledWith(1);
    expect(result).toEqual(rows);
  });

  it('markProcessed updates status to processed directly', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const getRepository = jest.fn().mockReturnValue({ update });
    const manager = { getRepository } as unknown as EntityManager;

    await service.markProcessed(7, manager);

    expect(getRepository).toHaveBeenCalledWith(Inbox);
    expect(update).toHaveBeenCalledWith(7, { status: 'processed' });
  });

  it('recordFailure increments attempts and stays pending under the cap', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: jest.fn().mockReturnValue({ update }),
    } as unknown as EntityManager;

    await service.recordFailure(
      { id: 7, attempts: 0 },
      new Error('boom'),
      { maxAttempts: 3 },
      manager,
    );

    expect(update).toHaveBeenCalledWith(7, {
      attempts: 1,
      status: 'pending',
      lastError: 'boom',
    });
  });

  it('recordFailure marks failed when attempts reach the cap', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: jest.fn().mockReturnValue({ update }),
    } as unknown as EntityManager;

    await service.recordFailure(
      { id: 7, attempts: 2 },
      new Error('boom'),
      { maxAttempts: 3 },
      manager,
    );

    expect(update).toHaveBeenCalledWith(7, {
      attempts: 3,
      status: 'failed',
      lastError: 'boom',
    });
  });

  it('markFailed sets failed immediately with lastError', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: jest.fn().mockReturnValue({ update }),
    } as unknown as EntityManager;

    await service.markFailed(7, 'no handler for other.event', manager);

    expect(update).toHaveBeenCalledWith(7, {
      status: 'failed',
      lastError: 'no handler for other.event',
    });
  });
});
