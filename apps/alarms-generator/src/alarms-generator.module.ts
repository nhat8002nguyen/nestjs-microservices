import { NatsClientModule, TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ALARMS_SERVICE } from '../constants';
import { AlarmsGeneratorService } from './alarms-generator.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TracingModule,
    NatsClientModule.register([
      { name: ALARMS_SERVICE, queue: 'alarms-service' },
    ]),
  ],
  controllers: [],
  providers: [AlarmsGeneratorService],
})
export class AlarmsGeneratorModule {}
