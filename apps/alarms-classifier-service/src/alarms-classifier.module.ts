import { TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { AlarmsClassifierController } from './alarms-classifier.controller';
import { AlarmsClassifierService } from './alarms-classifier.service';

@Module({
  imports: [TracingModule],
  controllers: [AlarmsClassifierController],
  providers: [AlarmsClassifierService],
})
export class AlarmsClassifierModule {}
