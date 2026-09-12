import { ClientProxy } from '@nestjs/microservices';
import { of } from 'rxjs';
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
});
