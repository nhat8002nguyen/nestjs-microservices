import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);
  constructor(private readonly notificationsService: NotificationsService) {}

  @EventPattern('notifications.create')
  createNotification(@Payload() notification: { alarmId: string }) {
    this.logger.log(`Creating notification: ${JSON.stringify(notification)}`);

    return {
      id: 'notification-' + Math.random().toString(36).substring(2, 10),
      alarmId: notification.alarmId,
    };
  }
}
