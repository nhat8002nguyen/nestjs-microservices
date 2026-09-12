import { NatsClientModule, RmqClientModule, TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { AlarmsServiceController } from './alarms-service.controller';
import { AlarmsServiceService } from './alarms-service.service';
import { ALARMS_CLASSIFIER_SERVICE, NOTIFICATIONS_SERVICE } from './constants';

@Module({
  imports: [
    TracingModule,
    NatsClientModule.register([
      { name: ALARMS_CLASSIFIER_SERVICE, queue: 'alarms-classifier-service' },
    ]),
    RmqClientModule.register([
      { name: NOTIFICATIONS_SERVICE, queue: 'notifications-service' },
    ]),
  ],
  controllers: [AlarmsServiceController],
  providers: [AlarmsServiceService],
})
export class AlarmsServiceModule {}
