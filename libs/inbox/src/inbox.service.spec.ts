import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError } from 'typeorm';
import { Inbox } from './entities/inbox.entity';
import { InboxService } from './inbox.service';

describe('InboxService', () => {
  let service: InboxService;
  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    findOneBy: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn(),
      save: jest.fn(),
      findOneBy: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxService,
        { provide: getRepositoryToken(Inbox), useValue: repository },
      ],
    }).compile();

    service = module.get(InboxService);
  });

  it('store inserts a pending inbox row', async () => {
    const input = {
      messageId: 'outbox:1',
      type: 'workflows.create',
      payload: { name: 'wf', buildingId: 1 },
    };
    const created = { ...input, status: 'pending' };
    const saved = { id: 1, ...created };
    repository.create.mockReturnValue(created);
    repository.save.mockResolvedValue(saved);

    const result = await service.store(input);

    expect(repository.create).toHaveBeenCalledWith({
      messageId: input.messageId,
      type: input.type,
      payload: input.payload,
    });
    expect(repository.save).toHaveBeenCalledWith(created);
    expect(result).toEqual(saved);
  });

  it('store treats duplicate messageId as already stored', async () => {
    const input = {
      messageId: 'outbox:1',
      type: 'workflows.create',
      payload: { name: 'wf', buildingId: 1 },
    };
    const existing = { id: 1, ...input, status: 'pending' };
    repository.create.mockReturnValue(input);
    repository.save.mockRejectedValue(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate'), { code: '23505' }),
      ),
    );
    repository.findOneBy.mockResolvedValue(existing);

    const result = await service.store(input);

    expect(result).toEqual(existing);
    expect(repository.findOneBy).toHaveBeenCalledWith({
      messageId: 'outbox:1',
    });
  });

  it('store rethrows errors that are not unique violations', async () => {
    repository.create.mockReturnValue({});
    repository.save.mockRejectedValue(new Error('db down'));

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
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue({ setLock }),
    } as unknown as EntityManager;

    const result = await service.claimPending({
      take: 1,
      maxAttempts: 3,
      manager,
    });

    expect(manager.createQueryBuilder).toHaveBeenCalledWith(Inbox, 'inbox');
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

  it('markProcessed sets status to processed on the transaction manager', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const findOneByOrFail = jest.fn().mockResolvedValue({
      id: 7,
      status: 'pending',
    });
    const manager = {
      getRepository: jest.fn().mockReturnValue({ findOneByOrFail, save }),
    } as unknown as EntityManager;

    await service.markProcessed(7, manager);

    expect(manager.getRepository).toHaveBeenCalledWith(Inbox);
    expect(save).toHaveBeenCalledWith({ id: 7, status: 'processed' });
  });

  it('recordFailure increments attempts and stays pending under the cap', async () => {
    const row = {
      id: 7,
      status: 'pending' as const,
      attempts: 0,
      lastError: null as string | null,
    };
    const save = jest.fn().mockResolvedValue(undefined);
    const findOneByOrFail = jest.fn().mockResolvedValue(row);
    const manager = {
      getRepository: jest.fn().mockReturnValue({ findOneByOrFail, save }),
    } as unknown as EntityManager;

    await service.recordFailure(7, new Error('boom'), { maxAttempts: 3 }, manager);

    expect(row.attempts).toBe(1);
    expect(row.status).toBe('pending');
    expect(row.lastError).toBe('boom');
    expect(save).toHaveBeenCalledWith(row);
  });

  it('recordFailure marks failed when attempts reach the cap', async () => {
    const row = {
      id: 7,
      status: 'pending' as const,
      attempts: 2,
      lastError: null as string | null,
    };
    const save = jest.fn().mockResolvedValue(undefined);
    const findOneByOrFail = jest.fn().mockResolvedValue(row);
    const manager = {
      getRepository: jest.fn().mockReturnValue({ findOneByOrFail, save }),
    } as unknown as EntityManager;

    await service.recordFailure(7, new Error('boom'), { maxAttempts: 3 }, manager);

    expect(row.attempts).toBe(3);
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('boom');
  });

  it('markFailed sets failed immediately with lastError', async () => {
    const row = {
      id: 7,
      status: 'pending' as const,
      lastError: null as string | null,
    };
    const save = jest.fn().mockResolvedValue(undefined);
    const findOneByOrFail = jest.fn().mockResolvedValue(row);
    const manager = {
      getRepository: jest.fn().mockReturnValue({ findOneByOrFail, save }),
    } as unknown as EntityManager;

    await service.markFailed(7, 'no handler for other.event', manager);

    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('no handler for other.event');
    expect(save).toHaveBeenCalledWith(row);
  });
});
