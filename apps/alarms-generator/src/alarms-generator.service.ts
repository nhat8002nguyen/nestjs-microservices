import {
  TraceContextService,
  type TracingClientProxy,
  TracingLogger,
} from '@app/tracing';
import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { lastValueFrom } from 'rxjs';
import { ALARMS_SERVICE } from '../constants';

@Injectable()
export class AlarmsGeneratorService {
  constructor(
    private readonly logger: TracingLogger,
    private readonly traceContext: TraceContextService,
    @Inject(ALARMS_SERVICE)
    private readonly alarmsService: TracingClientProxy,
  ) {}

  // Interval ticks run outside any Nest execution context, so this is where a
  // trace is born rather than inherited from an inbound message.
  @Interval(10000)
  generateAlarms(): Promise<void> {
    return this.traceContext.runWithNewTrace(async () => {
      const alarm = {
        name: 'Alarm #' + Math.random().toString(36).substring(2, 10),
        buildingId: Math.floor(Math.random() * 1000) + 1,
      };
      this.logger.log(`Generating alarm: ${JSON.stringify(alarm)}`);
      await lastValueFrom(this.alarmsService.emit('alarms.create', alarm));
    });
  }
}
