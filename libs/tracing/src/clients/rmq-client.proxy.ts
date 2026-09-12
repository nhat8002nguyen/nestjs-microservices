import { ClientProxy, RmqRecord } from '@nestjs/microservices';
import { TraceContextService } from '../trace-context.service';
import { TRACE_ID_HEADER } from '../tracing.constants';
import { TracingClientProxyBase } from './tracing-client-proxy.base';

export class RmqClientProxy extends TracingClientProxyBase {
  constructor(
    client: ClientProxy,
    traceContext: TraceContextService,
    inquirer: object | string,
  ) {
    super(client, traceContext, inquirer, 'rmq');
  }

  protected attachTraceId(data: unknown, traceId: string): RmqRecord {
    const record = data instanceof RmqRecord ? data : new RmqRecord(data);
    return new RmqRecord(record.data, {
      ...record.options,
      headers: { ...record.options?.headers, [TRACE_ID_HEADER]: traceId },
    });
  }
}
