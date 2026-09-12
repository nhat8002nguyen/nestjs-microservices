import { TraceContextService, TraceService, TracingLogger } from '@app/tracing';
import { of } from 'rxjs';
import { AlarmsGeneratorService } from './alarms-generator.service';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('AlarmsGeneratorService', () => {
  let traceContext: TraceContextService;
  let observedTraceIds: (string | undefined)[];
  let client: { send: jest.Mock; emit: jest.Mock };
  let service: AlarmsGeneratorService;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    observedTraceIds = [];
    client = {
      send: jest.fn(),
      emit: jest.fn(() => {
        observedTraceIds.push(traceContext.getTraceId());
        return of(undefined);
      }),
    };
    service = new AlarmsGeneratorService(
      new TracingLogger('AlarmsGeneratorService', traceContext),
      traceContext,
      client,
    );
  });

  it('emits an alarm with a name and a building id', async () => {
    await service.generateAlarms();

    const [pattern, alarm] = client.emit.mock.calls[0] as [
      string,
      { name: string; buildingId: number },
    ];
    expect(pattern).toBe('alarms.create');
    expect(alarm.name).toMatch(/^Alarm #/);
    expect(typeof alarm.buildingId).toBe('number');
  });

  it('emits inside a freshly generated trace scope', async () => {
    await service.generateAlarms();

    expect(observedTraceIds[0]).toMatch(UUID_V4);
  });

  it('starts a new trace on every interval tick', async () => {
    await service.generateAlarms();
    await service.generateAlarms();

    expect(observedTraceIds[1]).not.toBe(observedTraceIds[0]);
  });

  it('leaves no trace scope open after the tick finishes', async () => {
    await service.generateAlarms();

    expect(traceContext.getTraceId()).toBeUndefined();
  });
});
