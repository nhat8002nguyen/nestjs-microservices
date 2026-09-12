import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TracingModule } from '../tracing.module';
import { NatsClientModule } from './nats-client.module';
import { NatsClientProxy } from './nats-client.proxy';

const ALARMS_CLIENT = Symbol('ALARMS_CLIENT');

@Injectable()
class FirstConsumer {
  constructor(@Inject(ALARMS_CLIENT) readonly client: NatsClientProxy) {}
}

@Injectable()
class SecondConsumer {
  constructor(@Inject(ALARMS_CLIENT) readonly client: NatsClientProxy) {}
}

describe('NatsClientModule', () => {
  it('gives every consumer its own proxy labelled with its own name', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TracingModule,
        NatsClientModule.register([
          { name: ALARMS_CLIENT, queue: 'alarms-service' },
        ]),
      ],
      providers: [FirstConsumer, SecondConsumer],
    }).compile();

    const first = moduleRef.get(FirstConsumer);
    const second = moduleRef.get(SecondConsumer);

    expect(first.client).toBeInstanceOf(NatsClientProxy);
    expect(first.client).not.toBe(second.client);
    expect(first.client.context).toBe('FirstConsumer');
    expect(second.client.context).toBe('SecondConsumer');

    await moduleRef.close();
  });
});
