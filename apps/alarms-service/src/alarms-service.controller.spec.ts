import { TraceContextService, TraceService, TracingLogger } from '@app/tracing';
import { of } from 'rxjs';
import { AlarmsServiceController } from './alarms-service.controller';

describe('AlarmsServiceController', () => {
  let traceContext: TraceContextService;
  let classifier: { send: jest.Mock; emit: jest.Mock };
  let notifications: { send: jest.Mock; emit: jest.Mock };
  let controller: AlarmsServiceController;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    classifier = {
      send: jest.fn(() => of({ id: 'alarm-1', classification: 'critical' })),
      emit: jest.fn(() => of(undefined)),
    };
    notifications = { send: jest.fn(), emit: jest.fn(() => of(undefined)) };
    controller = new AlarmsServiceController(
      new TracingLogger('AlarmsServiceController', traceContext),
      classifier,
      notifications,
    );
  });

  it('classifies the alarm and then requests a notification', async () => {
    const result = await controller.createAlarm({
      name: 'smoke',
      buildingId: 1,
    });

    expect(classifier.send).toHaveBeenCalledWith('alarms.classify', {
      name: 'smoke',
      buildingId: 1,
    });
    expect(notifications.emit).toHaveBeenCalledWith('notifications.create', {
      alarmId: 'alarm-1',
    });
    expect(result).toEqual({ id: 'alarm-1', classification: 'critical' });
  });

  it('makes both outbound calls inside the caller trace scope', async () => {
    const observed: (string | undefined)[] = [];
    classifier.send.mockImplementation(() => {
      observed.push(traceContext.getTraceId());
      return of({ id: 'alarm-1', classification: 'critical' });
    });
    notifications.emit.mockImplementation(() => {
      observed.push(traceContext.getTraceId());
      return of(undefined);
    });

    await traceContext.run('trace-1', () =>
      controller.createAlarm({ name: 'smoke', buildingId: 1 }),
    );

    expect(observed).toEqual(['trace-1', 'trace-1']);
  });
});
