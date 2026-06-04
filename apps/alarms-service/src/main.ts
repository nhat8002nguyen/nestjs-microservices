import { NestFactory } from '@nestjs/core';
import { AlarmsServiceModule } from './alarms-service.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AlarmsServiceModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      servers: [process.env.NATS_SERVER_HOST ?? 'nats-server:4222'],
      queue: 'alarms-service',
    },
  });
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3002);
}
bootstrap();
