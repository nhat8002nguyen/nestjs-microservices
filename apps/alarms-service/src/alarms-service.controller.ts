import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AlarmsServiceService } from './alarms-service.service';

@Controller()
export class AlarmsServiceController {
  private readonly logger = new Logger(AlarmsServiceController.name);
  constructor(private readonly alarmsServiceService: AlarmsServiceService) {}

  @MessagePattern('alarms.create')
  createAlarm(@Payload() alarm: unknown) {
    this.logger.log(`Creating alarm: ${JSON.stringify(alarm)}`);
    return true;
  }
}
