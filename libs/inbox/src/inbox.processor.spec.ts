import { DataSource, EntityManager } from 'typeorm';
import { Inbox } from './entities/inbox.entity';
import { InboxService } from './inbox.service';
import { InboxModuleOptions } from './inbox.types';

jest.mock('@nestjs/bullmq', () => ({
  Processor: () => (target: unknown) => target,
  WorkerHost: class WorkerHost {},
  InjectQueue: () => () => undefined,
}));

import { InboxProcessor } from './inbox.processor';

describe('InboxProcessor', () => {
  let inboxService: {
    claimPending: jest.Mock;
    markProcessed: jest.Mock;
    markFailed: jest.Mock;
    recordFailure: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let manager: EntityManager;
  let workflowsCreate: jest.Mock;
  let otherHandler: jest.Mock;
  let processor: InboxProcessor;

  const row = {
    id: 11,
    messageId: 'outbox:11',
    type: 'workflows.create',
    payload: { name: 'wf', buildingId: 1 },
    status: 'pending',
    attempts: 0,
  } as Inbox;

  beforeEach(() => {
    inboxService = {
      claimPending: jest.fn(),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    manager = { id: 'tx-manager' } as unknown as EntityManager;
    dataSource = {
      transaction: jest.fn(async (cb: (em: EntityManager) => Promise<unknown>) =>
        cb(manager),
      ),
    };
    workflowsCreate = jest.fn().mockResolvedValue(undefined);
    otherHandler = jest.fn().mockResolvedValue(undefined);

    const options: InboxModuleOptions = {
      redis: { host: 'redis', port: 6379 },
      repeatEveryMs: 10_000,
      take: 100,
      maxAttempts: 3,
      handlers: {
        'workflows.create': workflowsCreate,
        'other.event': otherHandler,
      },
    };

    processor = new InboxProcessor(
      inboxService as unknown as InboxService,
      dataSource as unknown as DataSource,
      options,
      { upsertJobScheduler: jest.fn() } as never,
    );
  });

  it('invokes the matching handler with the same EntityManager and marks processed', async () => {
    inboxService.claimPending
      .mockResolvedValueOnce([row])
      .mockResolvedValue([]);

    await processor.processPending();

    expect(workflowsCreate).toHaveBeenCalledWith(row.payload, manager);
    expect(inboxService.markProcessed).toHaveBeenCalledWith(row.id, manager);
    expect(otherHandler).not.toHaveBeenCalled();
  });

  it('dispatches a second registered type to its own handler', async () => {
    const otherRow = { ...row, id: 12, type: 'other.event' };
    inboxService.claimPending
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([otherRow])
      .mockResolvedValue([]);

    await processor.processPending();

    expect(workflowsCreate).toHaveBeenCalledWith(row.payload, manager);
    expect(otherHandler).toHaveBeenCalledWith(otherRow.payload, manager);
  });

  it('marks unknown types failed without calling a handler', async () => {
    const unknown = { ...row, type: 'unknown.event' };
    inboxService.claimPending
      .mockResolvedValueOnce([unknown])
      .mockResolvedValue([]);

    await processor.processPending();

    expect(workflowsCreate).not.toHaveBeenCalled();
    expect(otherHandler).not.toHaveBeenCalled();
    expect(inboxService.markFailed).toHaveBeenCalledWith(
      unknown.id,
      'no handler for unknown.event',
      manager,
    );
    expect(inboxService.markProcessed).not.toHaveBeenCalled();
  });

  it('rolls back the processing transaction and records failure when the handler throws', async () => {
    workflowsCreate.mockRejectedValue(new Error('create failed'));
    inboxService.claimPending
      .mockResolvedValueOnce([row])
      .mockResolvedValue([]);

    await processor.processPending();

    expect(inboxService.markProcessed).not.toHaveBeenCalled();
    expect(inboxService.recordFailure).toHaveBeenCalledWith(
      row.id,
      expect.objectContaining({ message: 'create failed' }),
      { maxAttempts: 3 },
      manager,
    );
    expect(dataSource.transaction).toHaveBeenCalledTimes(3);
  });

  it('stops the tick when no pending row is claimed', async () => {
    inboxService.claimPending.mockResolvedValue([]);

    await processor.processPending();

    expect(workflowsCreate).not.toHaveBeenCalled();
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });
});
