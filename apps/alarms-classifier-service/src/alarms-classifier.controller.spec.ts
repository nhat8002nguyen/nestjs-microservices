import { TraceContextService, TraceService, TracingLogger } from '@app/tracing';
import { Logger } from '@nestjs/common';
import { AlarmsClassifierController } from './alarms-classifier.controller';
import { AlarmsClassifierService } from './alarms-classifier.service';

describe('AlarmsClassifierController', () => {
  let traceContext: TraceContextService;
  let controller: AlarmsClassifierController;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    controller = new AlarmsClassifierController(
      new TracingLogger('AlarmsClassifierController', traceContext),
      new AlarmsClassifierService(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('classifies an alarm with an id and a known severity', () => {
    const result = controller.classifyAlarm({ name: 'smoke', buildingId: 1 });

    expect(result.id).toMatch(/^alarm-/);
    expect(['critical', 'major', 'minor', 'warning', 'info']).toContain(
      result.classification,
    );
  });

  it('logs the inbound trace id', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    traceContext.run('trace-1', () =>
      controller.classifyAlarm({ name: 'smoke', buildingId: 1 }),
    );

    expect(logSpy).toHaveBeenCalledWith(
      '[trace:trace-1] Classifying alarm: {"name":"smoke","buildingId":1}',
    );
  });
});
