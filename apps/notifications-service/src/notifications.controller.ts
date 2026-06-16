import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { NotificationsService } from './notifications.service';
import { Channel, Message } from 'amqplib';

@Controller()
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);
  constructor(private readonly notificationsService: NotificationsService) {}

  @EventPattern('notifications.create')
  createNotification(
    @Payload() notification: { alarmId: string },
    @Ctx() context: RmqContext,
  ) {
    this.logger.log(`--------------------------------`);
    this.logger.log(`Creating notification: ${JSON.stringify(notification)}`);
    const channel = context.getChannelRef() as Channel;
    const originalMessage = context.getMessage() as Message;

    if (originalMessage.fields.redelivered) {
      this.logger.log('Notification already processed, skipping');
      channel.ack(originalMessage);
      return;
    }

    this.logger.log('Notification not processed, requeuing');
    channel.nack(originalMessage);
    return;
  }
}
