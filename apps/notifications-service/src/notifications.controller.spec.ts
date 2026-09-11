import { Test, TestingModule } from '@nestjs/testing';
import { RmqContext } from '@nestjs/microservices';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let notificationsController: NotificationsController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [NotificationsService],
    }).compile();

    notificationsController = app.get(NotificationsController);
  });

  function contextWith(redelivered: boolean): {
    context: RmqContext;
    channel: { ack: jest.Mock; nack: jest.Mock };
    message: { fields: { redelivered: boolean } };
  } {
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const message = { fields: { redelivered } };
    const context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    return { context, channel, message };
  }

  it('acks a redelivered notification without nacking', () => {
    const { context, channel, message } = contextWith(true);

    notificationsController.createNotification({ alarmId: 'a1' }, context);

    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks a first delivery so it can be requeued', () => {
    const { context, channel, message } = contextWith(false);

    notificationsController.createNotification({ alarmId: 'a1' }, context);

    expect(channel.nack).toHaveBeenCalledWith(message);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
