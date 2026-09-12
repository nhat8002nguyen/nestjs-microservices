import { DynamicModule, Module } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import { RmqClientProxy } from './rmq-client.proxy';
import { createTracedClientModule } from './traced-client.module-factory';
import { ClientRegistration } from './tracing-client.types';

@Module({})
export class RmqClientModule {
  static register(registrations: ClientRegistration[]): DynamicModule {
    const urls = [process.env.RABBITMQ_HOST ?? 'amqp://rabbitmq:5672'];

    return createTracedClientModule({
      module: RmqClientModule,
      registrations,
      clientOptions: ({ queue }, name) => ({
        name,
        transport: Transport.RMQ,
        options: { urls, queue },
      }),
      createProxy: (client, traceContext, inquirer) =>
        new RmqClientProxy(client, traceContext, inquirer),
    });
  }
}
