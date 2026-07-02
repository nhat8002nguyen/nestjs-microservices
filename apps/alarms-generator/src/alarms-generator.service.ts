import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ALARMS_SERVICE } from '../constants';

@Injectable()
export class AlarmsGeneratorService {
  constructor(
    @Inject(ALARMS_SERVICE)
    private readonly alarmsService: ClientProxy,
  ) {}
  // @Interval(10000)
  generateAlarms() {
    const alarm = {
      name: 'Alarm #' + Math.random().toString(36).substring(2, 10),
      buildingId: Math.floor(Math.random() * 1000) + 1,
    };
    this.alarmsService.emit('alarms.create', alarm);
  }
}
