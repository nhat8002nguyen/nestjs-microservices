import { ClientProxy, NatsRecord } from '@nestjs/microservices';
import { headers as natsHeaders } from 'nats';
import { of } from 'rxjs';
import { TraceContextService } from '../trace-context.service';
import { TraceService } from '../trace.service';
import { NatsClientProxy } from './nats-client.proxy';

class AlarmsController {}

describe('NatsClientProxy', () => {
  let traceContext: TraceContextService;
  let client: { send: jest.Mock; emit: jest.Mock };
  let proxy: NatsClientProxy;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    client = {
      send: jest.fn(() => of('classified')),
      emit: jest.fn(() => of(undefined)),
    };
    proxy = new NatsClientProxy(
      client as unknown as ClientProxy,
      traceContext,
      new AlarmsController(),
    );
  });

  it('is labelled with the class that injected it', () => {
    expect(proxy.context).toBe('AlarmsController');
  });

  it('attaches the ambient trace id as a nats header on emit', () => {
    traceContext.run('trace-1', () => proxy.emit('alarms.create', { id: 7 }));

    const [pattern, record] = client.emit.mock.calls[0] as [string, NatsRecord];
    expect(pattern).toBe('alarms.create');
    expect(record).toBeInstanceOf(NatsRecord);
    expect(record.data).toEqual({ id: 7 });
    expect(record.headers.get('x-trace-id')).toBe('trace-1');
  });

  it('attaches the ambient trace id as a nats header on send', () => {
    traceContext.run('trace-1', () => proxy.send('alarms.classify', { id: 7 }));

    const [, record] = client.send.mock.calls[0] as [string, NatsRecord];
    expect(record.headers.get('x-trace-id')).toBe('trace-1');
  });

  it('sends the payload untouched outside a trace scope', () => {
    proxy.emit('alarms.create', { id: 7 });

    expect(client.emit).toHaveBeenCalledWith('alarms.create', { id: 7 });
  });

  it('merges the trace id into a caller-supplied NatsRecord', () => {
    const existing = natsHeaders();
    existing.set('x-tenant', 'acme');

    traceContext.run('trace-1', () =>
      proxy.emit('alarms.create', new NatsRecord({ id: 7 }, existing)),
    );

    const [, record] = client.emit.mock.calls[0] as [string, NatsRecord];
    expect(record.data).toEqual({ id: 7 });
    expect(record.headers.get('x-tenant')).toBe('acme');
    expect(record.headers.get('x-trace-id')).toBe('trace-1');
  });

  it('returns the observable produced by the underlying client', async () => {
    const result = await new Promise((resolve) =>
      proxy.send<string>('alarms.classify', { id: 7 }).subscribe(resolve),
    );

    expect(result).toBe('classified');
  });
});
