import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AlarmsClassifierModule } from './alarms-classifier.module';

async function bootstrap() {
  const app = await NestFactory.create(AlarmsClassifierModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      servers: [process.env.NATS_SERVER_HOST ?? 'nats-server:4222'],
      queue: 'alarms-classifier-service',
    },
  });
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3003);
}
bootstrap();
