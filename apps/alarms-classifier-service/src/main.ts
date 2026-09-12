import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AlarmsClassifierModule } from './alarms-classifier.module';

async function bootstrap() {
  const app = await NestFactory.create(AlarmsClassifierModule);
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.NATS,
      options: {
        servers: [process.env.NATS_SERVER_HOST ?? 'nats-server:4222'],
        queue: 'alarms-classifier-service',
      },
    },
    // Without this the microservice gets its own ApplicationConfig and the
    // globally registered TraceInterceptor never runs for message handlers.
    { inheritAppConfig: true },
  );
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3003);
}
bootstrap();
