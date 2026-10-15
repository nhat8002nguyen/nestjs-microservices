import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
import { DataSource, EntityManager } from 'typeorm';
import { Outbox } from './entities/outbox.entity';
import { OutboxProcessor } from './outbox.processor';
import { OutboxService } from './outbox.service';

describe('OutboxProcessor', () => {
  it('emits with messageId outbox:{id}', async () => {
    const emit = jest
      .fn<ReturnType<ClientProxy['emit']>, [string, unknown]>()
      .mockReturnValue(of(undefined));
    const processor = new OutboxProcessor(
      {} as OutboxService,
      {} as DataSource,
      { emit } as unknown as ClientProxy,
    );
    const message = {
      id: 42,
      type: 'workflows.create',
      payload: { name: 'wf', buildingId: 1 },
    } as unknown as Outbox;

    await processor.dispatchWorkflowEvent(message);

    expect(emit).toHaveBeenCalledTimes(1);
    const [pattern, record] = emit.mock.calls[0] as [
      string,
      { data: unknown; options?: { messageId?: string } },
    ];
    expect(pattern).toBe('workflows.create');
    expect(record.data).toEqual(message.payload);
    expect(record.options?.messageId).toBe('outbox:42');
  });

  it('claims pending outbox rows in a transaction and marks them processed', async () => {
    const message = {
      id: 42,
      type: 'workflows.create',
      payload: { name: 'wf', buildingId: 1 },
    } as unknown as Outbox;
    const manager = { id: 'tx-manager' } as unknown as EntityManager;
    const outboxService = {
      claimPending: jest
        .fn()
        .mockResolvedValueOnce([message])
        .mockResolvedValue([]),
      markAsProcessed: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn(
        async (cb: (em: EntityManager) => Promise<unknown>) => cb(manager),
      ),
    };
    const emit = jest.fn().mockReturnValue(of(undefined));

    const processor = new OutboxProcessor(
      outboxService as unknown as OutboxService,
      dataSource as unknown as DataSource,
      { emit } as unknown as ClientProxy,
    );

    await processor.processOutbox();

    expect(outboxService.claimPending).toHaveBeenCalledWith({
      target: 'WORKFLOWS_SERVICE',
      take: 1,
      manager,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(outboxService.markAsProcessed).toHaveBeenCalledWith(42, manager);
  });
});
