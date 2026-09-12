import { DynamicModule, Module } from '@nestjs/common';
import { Transport } from '@nestjs/microservices';
import { NatsClientProxy } from './nats-client.proxy';
import { createTracedClientModule } from './traced-client.module-factory';
import { ClientRegistration } from './tracing-client.types';

@Module({})
export class NatsClientModule {
  static register(registrations: ClientRegistration[]): DynamicModule {
    const servers = [process.env.NATS_SERVER_HOST ?? 'nats-server:4222'];

    return createTracedClientModule({
      module: NatsClientModule,
      registrations,
      clientOptions: ({ queue }, name) => ({
        name,
        transport: Transport.NATS,
        options: { servers, queue },
      }),
      createProxy: (client, traceContext, inquirer) =>
        new NatsClientProxy(client, traceContext, inquirer),
    });
  }
}
