import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NotificationsModule } from './notifications.module';

async function bootstrap() {
  const app = await NestFactory.create(NotificationsModule);
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_HOST ?? 'amqp://rabbitmq:5672'],
        queue: 'notifications-service',
        noAck: false,
      },
    },
    // Without this the microservice gets its own ApplicationConfig and the
    // globally registered TraceInterceptor never runs for message handlers.
    { inheritAppConfig: true },
  );
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3004);
}
bootstrap();
