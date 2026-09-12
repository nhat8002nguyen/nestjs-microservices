import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TraceContextService } from './trace-context.service';
import { TraceInterceptor } from './trace.interceptor';
import { TraceService } from './trace.service';
import { TracingLogger } from './tracing-logger.service';

@Global()
@Module({
  providers: [
    TraceService,
    TraceContextService,
    TracingLogger,
    { provide: APP_INTERCEPTOR, useClass: TraceInterceptor },
  ],
  exports: [TraceService, TraceContextService, TracingLogger],
})
export class TracingModule {}
