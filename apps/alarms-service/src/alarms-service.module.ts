import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AlarmsServiceController } from './alarms-service.controller';
import { AlarmsServiceService } from './alarms-service.service';
import { ALARMS_CLASSIFIER_SERVICE, NOTIFICATIONS_SERVICE } from './constants';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: ALARMS_CLASSIFIER_SERVICE,
        transport: Transport.NATS,
        options: {
          servers: [process.env.NATS_SERVER_HOST ?? 'nats-server:4222'],
          queue: 'alarms-classifier-service',
        },
      },
      {
        name: NOTIFICATIONS_SERVICE,
        transport: Transport.NATS,
        options: {
          servers: [process.env.NATS_SERVER_HOST ?? 'nats-server:4222'],
          queue: 'notifications-service',
        },
      },
    ]),
  ],
  controllers: [AlarmsServiceController],
  providers: [AlarmsServiceService],
})
export class AlarmsServiceModule {}
