import { Injectable } from '@nestjs/common';

@Injectable()
export class AlarmsClassifierService {
  getHello(): string {
    return 'Hello World!';
  }
}
