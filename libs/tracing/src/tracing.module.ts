import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TraceContextService } from './trace-context.service';
import { TraceInterceptor } from './trace.interceptor';
import { TracingLogger } from './tracing-logger.service';

@Global()
@Module({
  providers: [
    TraceContextService,
    TracingLogger,
    { provide: APP_INTERCEPTOR, useClass: TraceInterceptor },
  ],
  exports: [TraceContextService, TracingLogger],
})
export class TracingModule {}
