import { TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { AlarmsClassifierController } from './alarms-classifier.controller';

@Module({
  imports: [TracingModule],
  controllers: [AlarmsClassifierController],
})
export class AlarmsClassifierModule {}
