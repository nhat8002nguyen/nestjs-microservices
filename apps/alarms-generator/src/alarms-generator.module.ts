import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { ALARMS_SERVICE } from '../constants';
import { AlarmsGeneratorService } from './alarms-generator.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ClientsModule.register([
      {
        name: ALARMS_SERVICE,
        transport: Transport.NATS,
        options: {
          servers: [process.env.NATS_SERVER_HOST ?? 'nats-server:4222'],
          queue: 'alarms-service',
        },
      },
    ]),
  ],
  controllers: [],
  providers: [AlarmsGeneratorService],
})
export class AlarmsGeneratorModule {}
