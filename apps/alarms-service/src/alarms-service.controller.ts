import { Controller, Inject, Logger } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { ALARMS_CLASSIFIER_SERVICE, NOTIFICATIONS_SERVICE } from './constants';

@Controller()
export class AlarmsServiceController {
  private readonly logger = new Logger(AlarmsServiceController.name);
  constructor(
    @Inject(ALARMS_CLASSIFIER_SERVICE)
    private readonly alarmsClassifierService: ClientProxy,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notificationsService: ClientProxy,
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
