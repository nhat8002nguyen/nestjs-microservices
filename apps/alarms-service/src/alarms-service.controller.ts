import { type TracingClientProxy, TracingLogger } from '@app/tracing';
import { Controller, Inject } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { ALARMS_CLASSIFIER_SERVICE, NOTIFICATIONS_SERVICE } from './constants';

@Controller()
export class AlarmsServiceController {
  constructor(
    private readonly logger: TracingLogger,
    @Inject(ALARMS_CLASSIFIER_SERVICE)
    private readonly alarmsClassifierService: TracingClientProxy,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notificationsService: TracingClientProxy,
  ) {}

  @EventPattern('alarms.create')
  async createAlarm(@Payload() alarm: { name: string; buildingId: number }) {
    this.logger.log(`Creating alarm: ${JSON.stringify(alarm)}`);
    const classification = await lastValueFrom<{
      id: string;
      classification: string;
    }>(this.alarmsClassifierService.send('alarms.classify', alarm));
    this.logger.log(`Alarm classified: ${JSON.stringify(classification)}`);

    await lastValueFrom(
      this.notificationsService.emit('notifications.create', {
        alarmId: classification.id,
      }),
    );
    this.logger.log(
      `Notification created: ${JSON.stringify({ alarmId: classification.id })}`,
    );
    return classification;
  }
}
