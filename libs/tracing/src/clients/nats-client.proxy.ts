import { ClientProxy, NatsRecord } from '@nestjs/microservices';
import { headers as createNatsHeaders } from 'nats';
import { TraceContextService } from '../trace-context.service';
import { TRACE_ID_HEADER } from '../tracing.constants';
import { TracingClientProxyBase } from './tracing-client-proxy.base';

export class NatsClientProxy extends TracingClientProxyBase {
  constructor(
    client: ClientProxy,
    traceContext: TraceContextService,
    inquirer: object | string,
  ) {
    super(client, traceContext, inquirer, 'nats');
  }

  protected attachTraceId(data: unknown, traceId: string): NatsRecord {
    const record = data instanceof NatsRecord ? data : new NatsRecord(data);
    const headers = record.headers ?? createNatsHeaders();
    headers.set(TRACE_ID_HEADER, traceId);
    return new NatsRecord(record.data, headers);
  }
}
