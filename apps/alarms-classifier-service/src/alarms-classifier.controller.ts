import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AlarmsClassifierService } from './alarms-classifier.service';

@Controller()
export class AlarmsClassifierController {
  private readonly logger = new Logger(AlarmsClassifierController.name);
  constructor(
    private readonly alarmsClassifierService: AlarmsClassifierService,
  ) {}

  @MessagePattern('alarms.classify')
  classifyAlarm(@Payload() alarm: { name: string; buildingId: number }) {
    this.logger.log(`Classifying alarm: ${JSON.stringify(alarm)}`);

    return {
      id: 'alarm-' + Math.random().toString(36).substring(2, 10),
      classification: ['critical', 'major', 'minor', 'warning', 'info'][
        Math.floor(Math.random() * 5)
      ],
    };
  }
}
