import { TraceContextService, TraceService, TracingLogger } from '@app/tracing';
import { Logger } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let traceContext: TraceContextService;
  let controller: NotificationsController;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    controller = new NotificationsController(
      new TracingLogger('NotificationsController', traceContext),
      new NotificationsService(),
    );
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the trace id carried by the redelivered message', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { context } = contextWith(true);

    traceContext.run('trace-1', () =>
      controller.createNotification({ alarmId: 'a1' }, context),
    );

    expect(logSpy).toHaveBeenCalledWith(
      '[trace:trace-1] Creating notification: {"alarmId":"a1"}',
    );
  });

  it('acks a redelivered notification without nacking', () => {
    const { context, channel, message } = contextWith(true);

    controller.createNotification({ alarmId: 'a1' }, context);

    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks a first delivery so it can be requeued', () => {
    const { context, channel, message } = contextWith(false);

    controller.createNotification({ alarmId: 'a1' }, context);

    expect(channel.nack).toHaveBeenCalledWith(message);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
