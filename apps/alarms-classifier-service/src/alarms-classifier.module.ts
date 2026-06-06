import { Module } from '@nestjs/common';
import { AlarmsClassifierController } from './alarms-classifier.controller';
import { AlarmsClassifierService } from './alarms-classifier.service';

@Module({
  imports: [],
  controllers: [AlarmsClassifierController],
  providers: [AlarmsClassifierService],
})
export class AlarmsClassifierModule {}
