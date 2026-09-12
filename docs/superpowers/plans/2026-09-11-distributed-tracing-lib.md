# Distributed Tracing Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable `@app/tracing` library that stamps every HTTP request, RPC message handler, and cron/interval job with a trace id, propagates that id across NATS and RabbitMQ hops, and prefixes every log line with it.

**Architecture:** A singleton `TraceContextService` stores the current trace id in a Node `AsyncLocalStorage`. Inbound work enters a trace scope through a globally registered `TraceInterceptor` (covers both HTTP and RPC execution contexts); scheduled jobs enter one explicitly via `traceContext.runWithNewTrace()`. Outbound messages are sent through `NatsClientProxy` / `RmqClientProxy` — transient, `INQUIRER`-aware wrappers around Nest's `ClientProxy` that read the ambient trace id and attach it as a transport header (`x-trace-id`), leaving the message payload untouched. `TracingLogger` is a transient logger that names itself after the class that injected it (via `INQUIRER`) and prefixes messages with the ambient trace id.

**Tech Stack:** NestJS 11, `@nestjs/microservices` 11, `@nestjs/schedule`, `nats` 2.29, `amqplib`, RxJS 7, TypeScript 5.7, Jest 30 + ts-jest, yarn 1.22.

## Why AsyncLocalStorage instead of `Scope.REQUEST` + `CONTEXT`

`INQUIRER` is used here only for what it can actually do: tell a provider which class injected it, so `TracingLogger` and each client proxy can name themselves after their consumer. It cannot hold a trace id.

The obvious alternative for the id itself is a `Scope.REQUEST` provider injected with `CONTEXT` from `@nestjs/microservices`, and it *does* reach the header: `CONTEXT` is literally the string `"REQUEST"` (`microservices/tokens.d.ts`), and for RPC handlers Nest populates it with a `RequestContextHost` whose `.getContext()` returns the `NatsContext` / `RmqContext`. It was rejected for two reasons.

**1. Request scope silently disables the scheduler.** `@nestjs/schedule` only registers `@Cron`/`@Interval`/`@Timeout` on providers whose dependency tree is static (`schedule.explorer.js:49` — `wrapper.isDependencyTreeStatic() ? lookupSchedulers(...) : warnForNonStaticProviders(...)`). The moment `AlarmsGeneratorService` depends on a request-scoped trace context — directly, or transitively through a traced proxy — the tree becomes non-static and the interval never fires. Verified with a probe module containing two otherwise-identical providers:

```
WARN [Scheduler] Cannot register interval "GeneratorWithRequestScopedDep@tick" because it is defined in a non static provider.
>>> STATIC TREE: interval fired
>>> STATIC TREE: interval fired
```

Working around it requires `ContextIdFactory.create()` + `moduleRef.registerRequestByContextId()` + `await moduleRef.resolve(...)` in every scheduled method.

**2. Request scope bubbles up.** Proxies would have to be request-scoped to inject a request-scoped context, which makes every controller that injects them request-scoped too — a fresh controller instance per message.

**On statelessness:** `AsyncLocalStorage` is not literally stateless, but it is the *less* stateful of the two options. `TraceContextService` holds a single field created once and never mutated; the per-flow value lives in Node's async resource graph and disappears when the scope's callback returns — there is no key, no map, no eviction, no cleanup path to get wrong. A request-scoped provider, by contrast, allocates a new object per message and stores the id in a field on it.

**Nothing is lost by not injecting `CONTEXT`.** The object `CONTEXT.getContext()` would hand you is the same `NatsContext` / `RmqContext` instance that `TraceInterceptor` already receives from `ExecutionContext.switchToRpc().getContext()` in Task 5. The plan reads exactly that context — it just does not pay for request scope to reach it.

## Global Constraints

- **Node 20** (`Dockerfile`: `FROM node:20-alpine`). `node:crypto` `randomUUID` and `node:async_hooks` `AsyncLocalStorage` are both available; no polyfills, no extra dependencies.
- **TypeScript** target `ES2023`, `module`/`moduleResolution` `nodenext`, `strictNullChecks: true`, `noImplicitAny: false`, **`isolatedModules: true`**. Project is CommonJS — relative imports carry no file extension.
- **`isolatedModules` + `emitDecoratorMetadata` forces type-only imports in decorated signatures.** `TracingClientProxy` is an interface, so any constructor parameter annotated with it inside a `@Controller()`/`@Injectable()` class must import it with the inline type modifier or webpack fails with `TS1272`:

  ```ts
  import { type TracingClientProxy, TracingLogger } from '@app/tracing';
  ```

  `TracingLogger` is a class used as a DI token, so it stays a value import. This applies to Task 8 and Task 11.
- **Hybrid apps must opt into inheriting the global interceptor.** `alarms-service`, `alarms-classifier-service` and `notifications-service` all call `NestFactory.create(...)` then `app.connectMicroservice(...)`. `connectMicroservice` builds a **fresh `ApplicationConfig`** unless `inheritAppConfig: true` is passed (`nest-application.js:129-131`), so an `APP_INTERCEPTOR` registered by `TracingModule` applies only to the HTTP server and **never runs for message handlers**. Every one of those three `main.ts` files needs:

  ```ts
  app.connectMicroservice<MicroserviceOptions>(options, { inheritAppConfig: true });
  ```

  Symptom when missing: inbound handlers log with no `[trace:...]` prefix at all (not even a freshly generated one, since the scope is never opened). Unit tests cannot catch this — only the Task 12 end-to-end run does.
- **Package manager is yarn** (`preinstall` runs `only-allow yarn`). Never invoke `npm install`.
- **Prettier**: `singleQuote: true`, `trailingComma: "all"`.
- **Use `const`/`let`, never `var`.**
- **Comments only where the code cannot explain itself.** Do not narrate obvious lines.
- Trace id header name is exactly `x-trace-id` on every transport.
- Library import alias is exactly `@app/tracing`, matching the existing `@app/inbox` / `@app/outbox` / `@app/workflows` convention.
- Apps in scope: `alarms-generator`, `alarms-service`, `alarms-classifier-service`, `notifications-service`. Do **not** modify `virtual-facility`, `workflows-service`, `libs/inbox`, or `libs/outbox`.

---

## File Structure

```
libs/tracing/
  tsconfig.lib.json                       build config, mirrors libs/inbox
  src/
    index.ts                              public surface of @app/tracing
    tracing.constants.ts                  TRACE_ID_HEADER
    trace.service.ts                      TraceService — generates trace ids
    trace.service.spec.ts
    trace-context.service.ts              TraceContextService — AsyncLocalStorage store
    trace-context.service.spec.ts
    tracing-logger.service.ts             TracingLogger — transient, INQUIRER-named
    tracing-logger.service.spec.ts
    trace-headers.util.ts                 inbound header extraction (HTTP / NATS / RMQ)
    trace-headers.util.spec.ts
    trace.interceptor.ts                  TraceInterceptor — opens the scope
    trace.interceptor.spec.ts
    tracing.module.ts                     TracingModule — global, registers APP_INTERCEPTOR
    clients/
      tracing-client.types.ts             TracingClientProxy + ClientRegistration
      tracing-client-proxy.base.ts        shared send/emit, logging, trace gating
      traced-client.module-factory.ts     shared DI wiring for every transport
      nats-client.proxy.ts                how a trace id becomes a NATS header
      nats-client.proxy.spec.ts
      nats-client.module.ts               owns the NATS transport and server location
      nats-client.module.spec.ts
      rmq-client.proxy.ts                 how a trace id becomes an AMQP header
      rmq-client.proxy.spec.ts
      rmq-client.module.ts                owns the RMQ transport and broker location
```

**Responsibility split inside `clients/`.** Each transport module owns its transport *and its broker location* — `NatsClientModule` is the only place that knows about `NATS_SERVER_HOST`, `RmqClientModule` the only place that knows about `RABBITMQ_HOST`. Callers name a service token and a queue, nothing more:

```ts
NatsClientModule.register([
  { name: ALARMS_CLASSIFIER_SERVICE, queue: 'alarms-classifier-service' },
]);
```

This is deliberate. In the current codebase `process.env.NATS_SERVER_HOST ?? 'nats-server:4222'` is copy-pasted into every module that talks to NATS, and a module called `NatsClientModule` that still accepts a `servers` array is one typo away from being handed an AMQP URL. Moving the location inside the module makes the name honest and removes the duplication.

Everything the two transports genuinely share lives in exactly two places: `TracingClientProxyBase` (logging, reading the ambient trace id, deciding whether there is anything to attach) and `createTracedClientModule` (the transient-provider-per-inquirer DI wiring). What is left in each transport file is only the part that actually differs — a four-line header mechanic and a transport constant. A future Kafka or Redis transport is a ~20-line pair of files.

---

### Task 1: Scaffold the tracing library and TraceService

**Files:**
- Create: `libs/tracing/tsconfig.lib.json`
- Create: `libs/tracing/src/tracing.constants.ts`
- Create: `libs/tracing/src/trace.service.ts`
- Create: `libs/tracing/src/index.ts`
- Test: `libs/tracing/src/trace.service.spec.ts`
- Modify: `nest-cli.json` (add `tracing` library project)
- Modify: `tsconfig.json:24-43` (add `@app/tracing` paths)
- Modify: `package.json` (add `@app/tracing` to jest `moduleNameMapper`)

**Interfaces:**
- Consumes: nothing.
- Produces: `TraceService` with `generateTraceId(): string`; `TRACE_ID_HEADER: 'x-trace-id'`.

- [ ] **Step 1: Create the library build config**

Create `libs/tracing/tsconfig.lib.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "../../dist/libs/tracing"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

- [ ] **Step 2: Register the library with the Nest CLI**

In `nest-cli.json`, inside `"projects"`, add this entry after the `"outbox"` entry:

```json
    "tracing": {
      "type": "library",
      "root": "libs/tracing",
      "entryFile": "index",
      "sourceRoot": "libs/tracing/src",
      "compilerOptions": {
        "tsConfigPath": "libs/tracing/tsconfig.lib.json"
      }
    },
```

- [ ] **Step 3: Add the TypeScript path alias**

In `tsconfig.json`, inside `compilerOptions.paths`, add:

```json
      "@app/tracing": [
        "libs/tracing/src/index.ts"
      ],
      "@app/tracing/*": [
        "libs/tracing/src/*"
      ],
```

- [ ] **Step 4: Add the Jest module name mapping**

In `package.json`, inside `jest.moduleNameMapper`, add:

```json
      "^@app/tracing(|/.*)$": "<rootDir>/libs/tracing/src/$1",
```

- [ ] **Step 5: Write the failing test**

Create `libs/tracing/src/trace.service.spec.ts`:

```ts
import { TraceService } from './trace.service';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('TraceService', () => {
  const service = new TraceService();

  it('generates a v4 uuid', () => {
    expect(service.generateTraceId()).toMatch(UUID_V4);
  });

  it('generates a distinct id on every call', () => {
    const ids = new Set(
      Array.from({ length: 1000 }, () => service.generateTraceId()),
    );

    expect(ids.size).toBe(1000);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `yarn jest libs/tracing/src/trace.service.spec.ts`
Expected: FAIL with `Cannot find module './trace.service'`.

- [ ] **Step 7: Write the constants and the service**

Create `libs/tracing/src/tracing.constants.ts`:

```ts
export const TRACE_ID_HEADER = 'x-trace-id';
```

Create `libs/tracing/src/trace.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

@Injectable()
export class TraceService {
  generateTraceId(): string {
    return randomUUID();
  }
}
```

- [ ] **Step 8: Create the public entry point**

Create `libs/tracing/src/index.ts`:

```ts
export * from './trace.service';
export * from './tracing.constants';
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `yarn jest libs/tracing/src/trace.service.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 10: Commit**

```bash
git add libs/tracing nest-cli.json tsconfig.json package.json
git commit -m "feat(tracing): scaffold tracing library with TraceService"
```

---

### Task 2: TraceContextService — the AsyncLocalStorage store

**Files:**
- Create: `libs/tracing/src/trace-context.service.ts`
- Test: `libs/tracing/src/trace-context.service.spec.ts`
- Modify: `libs/tracing/src/index.ts`

**Interfaces:**
- Consumes: `TraceService.generateTraceId()` from Task 1.
- Produces: `TraceContextService` with `run<T>(traceId: string, callback: () => T): T`, `runWithNewTrace<T>(callback: (traceId: string) => T): T`, and `getTraceId(): string | undefined`. Also exports the `TraceStore` interface (`{ traceId: string }`).

- [ ] **Step 1: Write the failing test**

Create `libs/tracing/src/trace-context.service.spec.ts`:

```ts
import { TraceContextService } from './trace-context.service';
import { TraceService } from './trace.service';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('TraceContextService', () => {
  let context: TraceContextService;

  beforeEach(() => {
    context = new TraceContextService(new TraceService());
  });

  it('returns undefined outside of any trace scope', () => {
    expect(context.getTraceId()).toBeUndefined();
  });

  it('exposes the trace id inside the scope', () => {
    const seen = context.run('trace-1', () => context.getTraceId());

    expect(seen).toBe('trace-1');
  });

  it('keeps trace ids isolated across concurrent async flows', async () => {
    const flow = (traceId: string, wait: number) =>
      context.run(traceId, async () => {
        await delay(wait);
        return context.getTraceId();
      });

    const results = await Promise.all([
      flow('trace-a', 30),
      flow('trace-b', 10),
      flow('trace-c', 20),
    ]);

    expect(results).toEqual(['trace-a', 'trace-b', 'trace-c']);
  });

  it('restores the outer trace id after a nested scope ends', () => {
    context.run('outer', () => {
      context.run('inner', () => {
        expect(context.getTraceId()).toBe('inner');
      });

      expect(context.getTraceId()).toBe('outer');
    });
  });

  it('runWithNewTrace generates a fresh id per invocation', () => {
    const first = context.runWithNewTrace((traceId) => traceId);
    const second = context.runWithNewTrace((traceId) => traceId);

    expect(first).not.toBe(second);
  });

  it('runWithNewTrace exposes the generated id through getTraceId', () => {
    const [generated, observed] = context.runWithNewTrace(
      (traceId) => [traceId, context.getTraceId()] as const,
    );

    expect(observed).toBe(generated);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest libs/tracing/src/trace-context.service.spec.ts`
Expected: FAIL with `Cannot find module './trace-context.service'`.

- [ ] **Step 3: Write the implementation**

Create `libs/tracing/src/trace-context.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { TraceService } from './trace.service';

export interface TraceStore {
  traceId: string;
}

@Injectable()
export class TraceContextService {
  private readonly storage = new AsyncLocalStorage<TraceStore>();

  constructor(private readonly traceService: TraceService) {}

  run<T>(traceId: string, callback: () => T): T {
    return this.storage.run({ traceId }, callback);
  }

  runWithNewTrace<T>(callback: (traceId: string) => T): T {
    const traceId = this.traceService.generateTraceId();
    return this.storage.run({ traceId }, () => callback(traceId));
  }

  getTraceId(): string | undefined {
    return this.storage.getStore()?.traceId;
  }
}
```

- [ ] **Step 4: Export it**

In `libs/tracing/src/index.ts`, add:

```ts
export * from './trace-context.service';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn jest libs/tracing/src/trace-context.service.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add libs/tracing/src
git commit -m "feat(tracing): add AsyncLocalStorage-backed TraceContextService"
```

---

### Task 3: TracingLogger — transient, INQUIRER-named, trace-prefixed

**Files:**
- Create: `libs/tracing/src/tracing-logger.service.ts`
- Test: `libs/tracing/src/tracing-logger.service.spec.ts`
- Modify: `libs/tracing/src/index.ts`

**Interfaces:**
- Consumes: `TraceContextService.getTraceId()` from Task 2.
- Produces: `TracingLogger` — `Scope.TRANSIENT`, constructor `(inquirer: object | string, traceContext: TraceContextService)`, public `readonly context: string`, and `log` / `error` / `warn` / `debug` / `verbose` each `(message: unknown, ...optionalParams: unknown[]) => void`. It is directly constructible with `new` so the client proxies in Tasks 6 and 7 can build one from their own inquirer.

**Why `readonly context` is public:** the transient proxies need to surface which class they were resolved for, and it is the only observable proof that `INQUIRER` resolution worked. It is cheap, honest API.

- [ ] **Step 1: Write the failing test**

Create `libs/tracing/src/tracing-logger.service.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import { TraceContextService } from './trace-context.service';
import { TraceService } from './trace.service';
import { TracingLogger } from './tracing-logger.service';

class OrdersController {}

describe('TracingLogger', () => {
  let traceContext: TraceContextService;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('names itself after the class that injected it', () => {
    const logger = new TracingLogger(new OrdersController(), traceContext);

    expect(logger.context).toBe('OrdersController');
  });

  it('accepts a plain string context', () => {
    const logger = new TracingLogger('Bootstrap', traceContext);

    expect(logger.context).toBe('Bootstrap');
  });

  it('prefixes messages with the ambient trace id', () => {
    const logger = new TracingLogger(new OrdersController(), traceContext);

    traceContext.run('trace-1', () => logger.log('order received'));

    expect(logSpy).toHaveBeenCalledWith('[trace:trace-1] order received');
  });

  it('leaves messages untouched outside a trace scope', () => {
    const logger = new TracingLogger(new OrdersController(), traceContext);

    logger.log('order received');

    expect(logSpy).toHaveBeenCalledWith('order received');
  });

  it('forwards optional params such as error stacks', () => {
    const logger = new TracingLogger(new OrdersController(), traceContext);

    traceContext.run('trace-1', () => logger.error('boom', 'stack-trace'));

    expect(errorSpy).toHaveBeenCalledWith('[trace:trace-1] boom', 'stack-trace');
  });

  it('does not attempt to prefix non-string messages', () => {
    const logger = new TracingLogger(new OrdersController(), traceContext);
    const payload = { alarmId: 'a1' };

    traceContext.run('trace-1', () => logger.log(payload));

    expect(logSpy).toHaveBeenCalledWith(payload);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest libs/tracing/src/tracing-logger.service.spec.ts`
Expected: FAIL with `Cannot find module './tracing-logger.service'`.

- [ ] **Step 3: Write the implementation**

Create `libs/tracing/src/tracing-logger.service.ts`:

```ts
import { Inject, Injectable, Logger, LoggerService, Scope } from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';
import { TraceContextService } from './trace-context.service';

@Injectable({ scope: Scope.TRANSIENT })
export class TracingLogger implements LoggerService {
  readonly context: string;

  private readonly logger: Logger;

  constructor(
    @Inject(INQUIRER) inquirer: object | string,
    private readonly traceContext: TraceContextService,
  ) {
    this.context = resolveContextName(inquirer);
    this.logger = new Logger(this.context);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.log(this.withTraceId(message), ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(this.withTraceId(message), ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(this.withTraceId(message), ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(this.withTraceId(message), ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.verbose(this.withTraceId(message), ...optionalParams);
  }

  private withTraceId(message: unknown): unknown {
    const traceId = this.traceContext.getTraceId();
    if (!traceId || typeof message !== 'string') {
      return message;
    }
    return `[trace:${traceId}] ${message}`;
  }
}

function resolveContextName(inquirer: object | string | undefined): string {
  if (typeof inquirer === 'string') {
    return inquirer;
  }
  return inquirer?.constructor?.name ?? TracingLogger.name;
}
```

- [ ] **Step 4: Export it**

In `libs/tracing/src/index.ts`, add:

```ts
export * from './tracing-logger.service';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn jest libs/tracing/src/tracing-logger.service.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add libs/tracing/src
git commit -m "feat(tracing): add transient TracingLogger named via INQUIRER"
```

---

### Task 4: Inbound trace header extraction

**Files:**
- Create: `libs/tracing/src/trace-headers.util.ts`
- Test: `libs/tracing/src/trace-headers.util.spec.ts`

**Interfaces:**
- Consumes: `TRACE_ID_HEADER` from Task 1.
- Produces: `extractTraceIdFromHttpRequest(request: HttpRequestLike | undefined): string | undefined` and `extractTraceIdFromRpcContext(context: RpcContextLike | undefined): string | undefined`. Both return `undefined` when no usable id is present.

**Transport facts these functions must handle (verified against the installed packages):**
- NATS: `NatsContext.getHeaders()` returns the `nats` `MsgHdrs` object, whose `.get(key)` returns **`''`** (empty string), not `undefined`, for a missing key. Empty must be treated as absent.
- RabbitMQ: headers live at `RmqContext.getMessage().properties.headers[key]` and amqplib may hand them back as a `Buffer` rather than a string.
- HTTP: Express lower-cases header names, and a repeated header arrives as `string[]`.

- [ ] **Step 1: Write the failing test**

Create `libs/tracing/src/trace-headers.util.spec.ts`:

```ts
import { headers as natsHeaders } from 'nats';
import {
  extractTraceIdFromHttpRequest,
  extractTraceIdFromRpcContext,
} from './trace-headers.util';

describe('extractTraceIdFromHttpRequest', () => {
  it('reads the x-trace-id header', () => {
    const request = { headers: { 'x-trace-id': 'trace-1' } };

    expect(extractTraceIdFromHttpRequest(request)).toBe('trace-1');
  });

  it('takes the first value when the header is repeated', () => {
    const request = { headers: { 'x-trace-id': ['trace-1', 'trace-2'] } };

    expect(extractTraceIdFromHttpRequest(request)).toBe('trace-1');
  });

  it('returns undefined when the header is missing', () => {
    expect(extractTraceIdFromHttpRequest({ headers: {} })).toBeUndefined();
  });

  it('returns undefined when there is no request', () => {
    expect(extractTraceIdFromHttpRequest(undefined)).toBeUndefined();
  });
});

describe('extractTraceIdFromRpcContext', () => {
  it('reads the id from NATS message headers', () => {
    const msgHeaders = natsHeaders();
    msgHeaders.set('x-trace-id', 'trace-1');
    const context = { getHeaders: () => msgHeaders };

    expect(extractTraceIdFromRpcContext(context)).toBe('trace-1');
  });

  it('treats an empty NATS header value as absent', () => {
    const context = { getHeaders: () => natsHeaders() };

    expect(extractTraceIdFromRpcContext(context)).toBeUndefined();
  });

  it('returns undefined when a NATS message carries no headers', () => {
    const context = { getHeaders: () => undefined };

    expect(extractTraceIdFromRpcContext(context)).toBeUndefined();
  });

  it('reads the id from RabbitMQ message properties', () => {
    const context = {
      getMessage: () => ({
        properties: { headers: { 'x-trace-id': 'trace-1' } },
      }),
    };

    expect(extractTraceIdFromRpcContext(context)).toBe('trace-1');
  });

  it('decodes a RabbitMQ header delivered as a Buffer', () => {
    const context = {
      getMessage: () => ({
        properties: { headers: { 'x-trace-id': Buffer.from('trace-1') } },
      }),
    };

    expect(extractTraceIdFromRpcContext(context)).toBe('trace-1');
  });

  it('returns undefined for a RabbitMQ message without headers', () => {
    const context = { getMessage: () => ({ properties: {} }) };

    expect(extractTraceIdFromRpcContext(context)).toBeUndefined();
  });

  it('returns undefined for an unrecognised context', () => {
    expect(extractTraceIdFromRpcContext({})).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest libs/tracing/src/trace-headers.util.spec.ts`
Expected: FAIL with `Cannot find module './trace-headers.util'`.

- [ ] **Step 3: Write the implementation**

Create `libs/tracing/src/trace-headers.util.ts`:

```ts
import { TRACE_ID_HEADER } from './tracing.constants';

export interface HttpRequestLike {
  headers?: Record<string, unknown>;
}

export interface RpcContextLike {
  getHeaders?: () => { get?: (key: string) => unknown } | undefined;
  getMessage?: () => { properties?: { headers?: Record<string, unknown> } };
}

export function extractTraceIdFromHttpRequest(
  request: HttpRequestLike | undefined,
): string | undefined {
  const value = request?.headers?.[TRACE_ID_HEADER];
  return normalize(Array.isArray(value) ? value[0] : value);
}

export function extractTraceIdFromRpcContext(
  context: RpcContextLike | undefined,
): string | undefined {
  const fromNats = normalize(context?.getHeaders?.()?.get?.(TRACE_ID_HEADER));
  if (fromNats) {
    return fromNats;
  }

  const rmqHeaders = context?.getMessage?.()?.properties?.headers;
  return normalize(rmqHeaders?.[TRACE_ID_HEADER]);
}

function normalize(value: unknown): string | undefined {
  if (Buffer.isBuffer(value)) {
    return normalize(value.toString());
  }
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn jest libs/tracing/src/trace-headers.util.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/tracing/src
git commit -m "feat(tracing): extract inbound trace ids from http, nats and rmq"
```

---

### Task 5: TraceInterceptor and TracingModule

**Files:**
- Create: `libs/tracing/src/trace.interceptor.ts`
- Create: `libs/tracing/src/tracing.module.ts`
- Test: `libs/tracing/src/trace.interceptor.spec.ts`
- Modify: `libs/tracing/src/index.ts`

**Interfaces:**
- Consumes: `TraceContextService` (Task 2), `TraceService` (Task 1), both extractors (Task 4).
- Produces: `TraceInterceptor implements NestInterceptor`, and `TracingModule` — a `@Global()` static module providing and exporting `TraceService`, `TraceContextService`, `TracingLogger`, plus an `APP_INTERCEPTOR` binding for `TraceInterceptor`.

**Two design points that are easy to get wrong:**

1. **The scope must wrap `subscribe()`, not `intercept()`.** `next.handle()` is lazy — the route/message handler does not run until something subscribes, which happens *after* `intercept()` returns. Calling `traceContext.run(id, () => next.handle())` would therefore close the scope before the handler ever executes. The implementation wraps the subscription instead.

2. **`TracingModule` is a plain static module, not a `forRoot()` dynamic module.** Nest derives a module's identity token from the class *plus* its dynamic metadata, so `TracingModule` and `TracingModule.forRoot()` would instantiate as two separate modules — each with its own `TraceContextService` and therefore its own `AsyncLocalStorage`. Trace ids written by one would be invisible to the other. Keeping it static guarantees one store process-wide, no matter how many modules import it.

- [ ] **Step 1: Write the failing test**

Create `libs/tracing/src/trace.interceptor.spec.ts`:

```ts
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { headers as natsHeaders } from 'nats';
import { defer, firstValueFrom, of } from 'rxjs';
import { TraceContextService } from './trace-context.service';
import { TraceInterceptor } from './trace.interceptor';
import { TraceService } from './trace.service';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('TraceInterceptor', () => {
  let traceContext: TraceContextService;
  let interceptor: TraceInterceptor;

  beforeEach(() => {
    const traceService = new TraceService();
    traceContext = new TraceContextService(traceService);
    interceptor = new TraceInterceptor(traceContext, traceService);
  });

  // The handler must observe the trace id, so it has to read it lazily at
  // subscription time - exactly like a real Nest handler does.
  const handler: CallHandler = {
    handle: () => defer(() => of(traceContext.getTraceId())),
  };

  function httpContext(headers: Record<string, unknown>): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as unknown as ExecutionContext;
  }

  function rpcContext(context: unknown): ExecutionContext {
    return {
      getType: () => 'rpc',
      switchToRpc: () => ({ getContext: () => context }),
    } as unknown as ExecutionContext;
  }

  it('runs an http handler inside the inbound trace scope', async () => {
    const observed = await firstValueFrom(
      interceptor.intercept(httpContext({ 'x-trace-id': 'trace-1' }), handler),
    );

    expect(observed).toBe('trace-1');
  });

  it('runs a nats handler inside the inbound trace scope', async () => {
    const msgHeaders = natsHeaders();
    msgHeaders.set('x-trace-id', 'trace-2');

    const observed = await firstValueFrom(
      interceptor.intercept(
        rpcContext({ getHeaders: () => msgHeaders }),
        handler,
      ),
    );

    expect(observed).toBe('trace-2');
  });

  it('runs an rmq handler inside the inbound trace scope', async () => {
    const observed = await firstValueFrom(
      interceptor.intercept(
        rpcContext({
          getMessage: () => ({
            properties: { headers: { 'x-trace-id': 'trace-3' } },
          }),
        }),
        handler,
      ),
    );

    expect(observed).toBe('trace-3');
  });

  it('starts a new trace when the inbound message carries none', async () => {
    const observed = await firstValueFrom(
      interceptor.intercept(rpcContext({ getHeaders: () => undefined }), handler),
    );

    expect(observed).toMatch(UUID_V4);
  });

  it('gives each request its own trace id', async () => {
    const context = httpContext({});

    const first = await firstValueFrom(interceptor.intercept(context, handler));
    const second = await firstValueFrom(interceptor.intercept(context, handler));

    expect(first).not.toBe(second);
  });

  it('closes the scope once the handler completes', async () => {
    await firstValueFrom(
      interceptor.intercept(httpContext({ 'x-trace-id': 'trace-1' }), handler),
    );

    expect(traceContext.getTraceId()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest libs/tracing/src/trace.interceptor.spec.ts`
Expected: FAIL with `Cannot find module './trace.interceptor'`.

- [ ] **Step 3: Write the interceptor**

Create `libs/tracing/src/trace.interceptor.ts`:

```ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TraceContextService } from './trace-context.service';
import { TraceService } from './trace.service';
import {
  extractTraceIdFromHttpRequest,
  extractTraceIdFromRpcContext,
} from './trace-headers.util';

@Injectable()
export class TraceInterceptor implements NestInterceptor {
  constructor(
    private readonly traceContext: TraceContextService,
    private readonly traceService: TraceService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const traceId = this.resolveTraceId(context);

    // next.handle() is lazy: the handler only runs on subscribe, so the trace
    // scope has to wrap the subscription rather than this method's body.
    return new Observable((subscriber) =>
      this.traceContext.run(traceId, () => next.handle().subscribe(subscriber)),
    );
  }

  private resolveTraceId(context: ExecutionContext): string {
    return this.extractTraceId(context) ?? this.traceService.generateTraceId();
  }

  private extractTraceId(context: ExecutionContext): string | undefined {
    switch (context.getType<string>()) {
      case 'rpc':
        return extractTraceIdFromRpcContext(context.switchToRpc().getContext());
      case 'http':
        return extractTraceIdFromHttpRequest(context.switchToHttp().getRequest());
      default:
        return undefined;
    }
  }
}
```

- [ ] **Step 4: Write the module**

Create `libs/tracing/src/tracing.module.ts`:

```ts
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
```

- [ ] **Step 5: Export both**

In `libs/tracing/src/index.ts`, add:

```ts
export * from './trace-headers.util';
export * from './trace.interceptor';
export * from './tracing.module';
```

- [ ] **Step 6: Run the whole library suite to verify it passes**

Run: `yarn jest libs/tracing`
Expected: PASS, 31 tests across 5 suites.

- [ ] **Step 7: Commit**

```bash
git add libs/tracing/src
git commit -m "feat(tracing): add TraceInterceptor and global TracingModule"
```

---

### Task 6: Shared client plumbing plus the NATS transport

**Files:**
- Create: `libs/tracing/src/clients/tracing-client.types.ts`
- Create: `libs/tracing/src/clients/tracing-client-proxy.base.ts`
- Create: `libs/tracing/src/clients/traced-client.module-factory.ts`
- Create: `libs/tracing/src/clients/nats-client.proxy.ts`
- Create: `libs/tracing/src/clients/nats-client.module.ts`
- Test: `libs/tracing/src/clients/nats-client.proxy.spec.ts`
- Test: `libs/tracing/src/clients/nats-client.module.spec.ts`
- Modify: `libs/tracing/src/index.ts`

**Interfaces:**
- Consumes: `TraceContextService` (Task 2), `TracingLogger` (Task 3), `TRACE_ID_HEADER` (Task 1), `TracingModule` (Task 5).
- Produces:
  - `TracingClientProxy` — interface with `send<TResult, TInput>(pattern: unknown, data: TInput): Observable<TResult>` and `emit<TResult, TInput>(pattern: unknown, data: TInput): Observable<TResult>`. This is the type app controllers annotate their injected clients with, replacing `ClientProxy`.
  - `ClientRegistration` — `{ name: string | symbol; queue: string }`. Shared by every transport: a DI token and a queue, no connection details.
  - `TracingClientProxyBase` — abstract, constructor `(client: ClientProxy, traceContext: TraceContextService, inquirer: object | string, transport: string)`, public `readonly context: string`, and one abstract member `attachTraceId(data: unknown, traceId: string): unknown`.
  - `createTracedClientModule(definition: TracedClientModuleDefinition): DynamicModule`.
  - `NatsClientProxy extends TracingClientProxyBase` — constructor `(client: ClientProxy, traceContext: TraceContextService, inquirer: object | string)`.
  - `NatsClientModule.register(registrations: ClientRegistration[]): DynamicModule`.

**How the module wires it up:** for each registration it mints a private symbol token, hands that token to Nest's own `ClientsModule.register()` to build the real `ClientNats` (this is deliberate — `ClientsModule` attaches `onApplicationShutdown = close`, so connection teardown comes for free), then exposes the caller's token as a `Scope.TRANSIENT` factory provider that wraps the real client. The factory's `inject` array includes `INQUIRER`; Nest's injector resolves `INQUIRER` in factory `inject` arrays exactly as it does in constructor parameters, so each consuming class gets its own proxy instance labelled with its own name.

**Where the broker location lives:** inside `NatsClientModule.register()` and nowhere else. Callers pass a token and a queue. The env var is read at `register()` time rather than at module load so it stays testable.

- [ ] **Step 1: Write the failing proxy test**

Create `libs/tracing/src/clients/nats-client.proxy.spec.ts`:

```ts
import { ClientProxy, NatsRecord } from '@nestjs/microservices';
import { headers as natsHeaders } from 'nats';
import { of } from 'rxjs';
import { TraceContextService } from '../trace-context.service';
import { TraceService } from '../trace.service';
import { NatsClientProxy } from './nats-client.proxy';

class AlarmsController {}

describe('NatsClientProxy', () => {
  let traceContext: TraceContextService;
  let client: { send: jest.Mock; emit: jest.Mock };
  let proxy: NatsClientProxy;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    client = {
      send: jest.fn(() => of('classified')),
      emit: jest.fn(() => of(undefined)),
    };
    proxy = new NatsClientProxy(
      client as unknown as ClientProxy,
      traceContext,
      new AlarmsController(),
    );
  });

  it('is labelled with the class that injected it', () => {
    expect(proxy.context).toBe('AlarmsController');
  });

  it('attaches the ambient trace id as a nats header on emit', () => {
    traceContext.run('trace-1', () => proxy.emit('alarms.create', { id: 7 }));

    const [pattern, record] = client.emit.mock.calls[0] as [string, NatsRecord];
    expect(pattern).toBe('alarms.create');
    expect(record).toBeInstanceOf(NatsRecord);
    expect(record.data).toEqual({ id: 7 });
    expect(record.headers.get('x-trace-id')).toBe('trace-1');
  });

  it('attaches the ambient trace id as a nats header on send', () => {
    traceContext.run('trace-1', () => proxy.send('alarms.classify', { id: 7 }));

    const [, record] = client.send.mock.calls[0] as [string, NatsRecord];
    expect(record.headers.get('x-trace-id')).toBe('trace-1');
  });

  it('sends the payload untouched outside a trace scope', () => {
    proxy.emit('alarms.create', { id: 7 });

    expect(client.emit).toHaveBeenCalledWith('alarms.create', { id: 7 });
  });

  it('merges the trace id into a caller-supplied NatsRecord', () => {
    const existing = natsHeaders();
    existing.set('x-tenant', 'acme');

    traceContext.run('trace-1', () =>
      proxy.emit('alarms.create', new NatsRecord({ id: 7 }, existing)),
    );

    const [, record] = client.emit.mock.calls[0] as [string, NatsRecord];
    expect(record.data).toEqual({ id: 7 });
    expect(record.headers.get('x-tenant')).toBe('acme');
    expect(record.headers.get('x-trace-id')).toBe('trace-1');
  });

  it('returns the observable produced by the underlying client', async () => {
    const result = await new Promise((resolve) =>
      proxy.send<string>('alarms.classify', { id: 7 }).subscribe(resolve),
    );

    expect(result).toBe('classified');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest libs/tracing/src/clients/nats-client.proxy.spec.ts`
Expected: FAIL with `Cannot find module './nats-client.proxy'`.

- [ ] **Step 3: Write the shared client types**

Create `libs/tracing/src/clients/tracing-client.types.ts`:

```ts
import { Observable } from 'rxjs';

export interface TracingClientProxy {
  send<TResult = unknown, TInput = unknown>(
    pattern: unknown,
    data: TInput,
  ): Observable<TResult>;

  emit<TResult = unknown, TInput = unknown>(
    pattern: unknown,
    data: TInput,
  ): Observable<TResult>;
}

export interface ClientRegistration {
  name: string | symbol;
  queue: string;
}
```

- [ ] **Step 4: Write the shared proxy base**

Create `libs/tracing/src/clients/tracing-client-proxy.base.ts`:

```ts
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import { TraceContextService } from '../trace-context.service';
import { TracingLogger } from '../tracing-logger.service';
import { TracingClientProxy } from './tracing-client.types';

export abstract class TracingClientProxyBase implements TracingClientProxy {
  readonly context: string;

  private readonly logger: TracingLogger;

  constructor(
    private readonly client: ClientProxy,
    private readonly traceContext: TraceContextService,
    inquirer: object | string,
    private readonly transport: string,
  ) {
    this.logger = new TracingLogger(inquirer, traceContext);
    this.context = this.logger.context;
  }

  send<TResult = unknown, TInput = unknown>(
    pattern: unknown,
    data: TInput,
  ): Observable<TResult> {
    this.logger.log(`[${this.transport}] send ${String(pattern)}`);
    return this.client.send<TResult>(pattern, this.traced(data));
  }

  emit<TResult = unknown, TInput = unknown>(
    pattern: unknown,
    data: TInput,
  ): Observable<TResult> {
    this.logger.log(`[${this.transport}] emit ${String(pattern)}`);
    return this.client.emit<TResult>(pattern, this.traced(data));
  }

  private traced(data: unknown): unknown {
    const traceId = this.traceContext.getTraceId();
    return traceId ? this.attachTraceId(data, traceId) : data;
  }

  protected abstract attachTraceId(data: unknown, traceId: string): unknown;
}
```

- [ ] **Step 5: Write the NATS proxy**

Create `libs/tracing/src/clients/nats-client.proxy.ts`:

```ts
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
```

- [ ] **Step 6: Run the proxy test to verify it passes**

Run: `yarn jest libs/tracing/src/clients/nats-client.proxy.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Write the failing module test**

Create `libs/tracing/src/clients/nats-client.module.spec.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TracingModule } from '../tracing.module';
import { NatsClientModule } from './nats-client.module';
import { NatsClientProxy } from './nats-client.proxy';

const ALARMS_CLIENT = Symbol('ALARMS_CLIENT');

@Injectable()
class FirstConsumer {
  constructor(
    @Inject(ALARMS_CLIENT) readonly client: NatsClientProxy,
  ) {}
}

@Injectable()
class SecondConsumer {
  constructor(
    @Inject(ALARMS_CLIENT) readonly client: NatsClientProxy,
  ) {}
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
```

Note: `.compile()` builds the `ClientNats` instance but never connects — NATS connects lazily on first publish — so this test needs no running broker. Note also that the registration names a token and a queue only; the module supplies the server.

- [ ] **Step 8: Run the module test to verify it fails**

Run: `yarn jest libs/tracing/src/clients/nats-client.module.spec.ts`
Expected: FAIL with `Cannot find module './nats-client.module'`.

- [ ] **Step 9: Write the shared module factory**

Create `libs/tracing/src/clients/traced-client.module-factory.ts`:

```ts
import { DynamicModule, Scope, Type } from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';
import {
  ClientProviderOptions,
  ClientProxy,
  ClientsModule,
} from '@nestjs/microservices';
import { TraceContextService } from '../trace-context.service';
import { TracingModule } from '../tracing.module';
import { ClientRegistration, TracingClientProxy } from './tracing-client.types';

export interface TracedClientModuleDefinition {
  module: Type<unknown>;
  registrations: ClientRegistration[];
  clientOptions: (
    registration: ClientRegistration,
    name: symbol,
  ) => ClientProviderOptions;
  createProxy: (
    client: ClientProxy,
    traceContext: TraceContextService,
    inquirer: object,
  ) => TracingClientProxy;
}

export function createTracedClientModule({
  module,
  registrations,
  clientOptions,
  createProxy,
}: TracedClientModuleDefinition): DynamicModule {
  const entries = registrations.map((registration) => ({
    registration,
    clientToken: Symbol(`${String(registration.name)}_CLIENT`),
  }));

  return {
    module,
    imports: [
      TracingModule,
      ClientsModule.register(
        entries.map(({ registration, clientToken }) =>
          clientOptions(registration, clientToken),
        ),
      ),
    ],
    providers: entries.map(({ registration, clientToken }) => ({
      provide: registration.name,
      scope: Scope.TRANSIENT,
      inject: [clientToken, TraceContextService, INQUIRER],
      useFactory: createProxy,
    })),
    exports: entries.map(({ registration }) => registration.name),
  };
}
```

- [ ] **Step 10: Write the NATS module**

Create `libs/tracing/src/clients/nats-client.module.ts`:

```ts
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
```

- [ ] **Step 11: Export the client surface**

In `libs/tracing/src/index.ts`, add:

```ts
export * from './clients/nats-client.module';
export * from './clients/nats-client.proxy';
export * from './clients/traced-client.module-factory';
export * from './clients/tracing-client-proxy.base';
export * from './clients/tracing-client.types';
```

- [ ] **Step 12: Run both tests to verify they pass**

Run: `yarn jest libs/tracing/src/clients`
Expected: PASS, 7 tests across 2 suites.

- [ ] **Step 13: Commit**

```bash
git add libs/tracing/src
git commit -m "feat(tracing): add trace-propagating NATS client proxy and module"
```

---

### Task 7: RmqClientProxy and RmqClientModule

**Files:**
- Create: `libs/tracing/src/clients/rmq-client.proxy.ts`
- Create: `libs/tracing/src/clients/rmq-client.module.ts`
- Test: `libs/tracing/src/clients/rmq-client.proxy.spec.ts`
- Modify: `libs/tracing/src/index.ts`

**Interfaces:**
- Consumes: `TracingClientProxyBase`, `createTracedClientModule`, and `ClientRegistration` from Task 6.
- Produces:
  - `RmqClientProxy extends TracingClientProxyBase` — constructor `(client: ClientProxy, traceContext: TraceContextService, inquirer: object | string)`.
  - `RmqClientModule.register(registrations: ClientRegistration[]): DynamicModule`.

Because Task 6 factored out the base proxy and the module factory, this whole task is two short files: RabbitMQ's header mechanic and its broker location. RabbitMQ carries the id in AMQP publish options rather than in a `MsgHdrs` object, so the merge preserves any caller-supplied options such as the `messageId` the outbox processor sets.

- [ ] **Step 1: Write the failing test**

Create `libs/tracing/src/clients/rmq-client.proxy.spec.ts`:

```ts
import { ClientProxy, RmqRecord } from '@nestjs/microservices';
import { of } from 'rxjs';
import { TraceContextService } from '../trace-context.service';
import { TraceService } from '../trace.service';
import { RmqClientProxy } from './rmq-client.proxy';

class NotificationsPublisher {}

describe('RmqClientProxy', () => {
  let traceContext: TraceContextService;
  let client: { send: jest.Mock; emit: jest.Mock };
  let proxy: RmqClientProxy;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    client = {
      send: jest.fn(() => of('ok')),
      emit: jest.fn(() => of(undefined)),
    };
    proxy = new RmqClientProxy(
      client as unknown as ClientProxy,
      traceContext,
      new NotificationsPublisher(),
    );
  });

  it('is labelled with the class that injected it', () => {
    expect(proxy.context).toBe('NotificationsPublisher');
  });

  it('attaches the ambient trace id as an amqp header on emit', () => {
    traceContext.run('trace-1', () =>
      proxy.emit('notifications.create', { alarmId: 'a1' }),
    );

    const [pattern, record] = client.emit.mock.calls[0] as [string, RmqRecord];
    expect(pattern).toBe('notifications.create');
    expect(record).toBeInstanceOf(RmqRecord);
    expect(record.data).toEqual({ alarmId: 'a1' });
    expect(record.options?.headers).toEqual({ 'x-trace-id': 'trace-1' });
  });

  it('attaches the ambient trace id as an amqp header on send', () => {
    traceContext.run('trace-1', () =>
      proxy.send('notifications.create', { alarmId: 'a1' }),
    );

    const [, record] = client.send.mock.calls[0] as [string, RmqRecord];
    expect(record.options?.headers).toEqual({ 'x-trace-id': 'trace-1' });
  });

  it('sends the payload untouched outside a trace scope', () => {
    proxy.emit('notifications.create', { alarmId: 'a1' });

    expect(client.emit).toHaveBeenCalledWith('notifications.create', {
      alarmId: 'a1',
    });
  });

  it('preserves caller-supplied options when merging into an RmqRecord', () => {
    const existing = new RmqRecord(
      { alarmId: 'a1' },
      { messageId: 'outbox:1', headers: { 'x-tenant': 'acme' } },
    );

    traceContext.run('trace-1', () => proxy.emit('notifications.create', existing));

    const [, record] = client.emit.mock.calls[0] as [string, RmqRecord];
    expect(record.data).toEqual({ alarmId: 'a1' });
    expect(record.options?.messageId).toBe('outbox:1');
    expect(record.options?.headers).toEqual({
      'x-tenant': 'acme',
      'x-trace-id': 'trace-1',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest libs/tracing/src/clients/rmq-client.proxy.spec.ts`
Expected: FAIL with `Cannot find module './rmq-client.proxy'`.

- [ ] **Step 3: Write the proxy**

Create `libs/tracing/src/clients/rmq-client.proxy.ts`:

```ts
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
```

- [ ] **Step 4: Write the module**

Create `libs/tracing/src/clients/rmq-client.module.ts`:

```ts
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
```

- [ ] **Step 5: Export it**

In `libs/tracing/src/index.ts`, add:

```ts
export * from './clients/rmq-client.module';
export * from './clients/rmq-client.proxy';
```

The finished `libs/tracing/src/index.ts` reads:

```ts
export * from './clients/nats-client.module';
export * from './clients/nats-client.proxy';
export * from './clients/rmq-client.module';
export * from './clients/rmq-client.proxy';
export * from './clients/traced-client.module-factory';
export * from './clients/tracing-client-proxy.base';
export * from './clients/tracing-client.types';
export * from './trace-context.service';
export * from './trace-headers.util';
export * from './trace.interceptor';
export * from './trace.service';
export * from './tracing-logger.service';
export * from './tracing.constants';
export * from './tracing.module';
```

- [ ] **Step 6: Run the full library suite to verify it passes**

Run: `yarn jest libs/tracing`
Expected: PASS, 43 tests across 8 suites.

- [ ] **Step 7: Commit**

```bash
git add libs/tracing/src
git commit -m "feat(tracing): add trace-propagating RMQ client proxy and module"
```

---

### Task 8: Wire alarms-service

**Files:**
- Modify: `apps/alarms-service/src/alarms-service.module.ts` (full rewrite, 31 lines)
- Modify: `apps/alarms-service/src/alarms-service.controller.ts` (full rewrite, 35 lines)
- Test: `apps/alarms-service/src/alarms-service.controller.spec.ts` (create)

**Interfaces:**
- Consumes: `TracingModule`, `TracingLogger`, `TracingClientProxy`, `NatsClientModule.register()`, `RmqClientModule.register()` from Tasks 3, 5, 6, 7.
- Produces: nothing for later tasks.

`apps/alarms-service/src/constants.ts` is unchanged — the existing `ALARMS_CLASSIFIER_SERVICE` and `NOTIFICATIONS_SERVICE` symbols become the tokens for the traced proxies.

Injecting a transient `TracingLogger` or proxy does **not** make `AlarmsServiceController` transient: only `Scope.REQUEST` bubbles up to the host in Nest. The controller stays a singleton and per-message isolation comes entirely from the `AsyncLocalStorage` scope the interceptor opens.

- [ ] **Step 1: Write the failing test**

Create `apps/alarms-service/src/alarms-service.controller.spec.ts`:

```ts
import { TraceContextService, TraceService, TracingLogger } from '@app/tracing';
import { of } from 'rxjs';
import { AlarmsServiceController } from './alarms-service.controller';

describe('AlarmsServiceController', () => {
  let traceContext: TraceContextService;
  let classifier: { send: jest.Mock; emit: jest.Mock };
  let notifications: { send: jest.Mock; emit: jest.Mock };
  let controller: AlarmsServiceController;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    classifier = {
      send: jest.fn(() => of({ id: 'alarm-1', classification: 'critical' })),
      emit: jest.fn(() => of(undefined)),
    };
    notifications = { send: jest.fn(), emit: jest.fn(() => of(undefined)) };
    controller = new AlarmsServiceController(
      new TracingLogger('AlarmsServiceController', traceContext),
      classifier,
      notifications,
    );
  });

  it('classifies the alarm and then requests a notification', async () => {
    const result = await controller.createAlarm({ name: 'smoke', buildingId: 1 });

    expect(classifier.send).toHaveBeenCalledWith('alarms.classify', {
      name: 'smoke',
      buildingId: 1,
    });
    expect(notifications.emit).toHaveBeenCalledWith('notifications.create', {
      alarmId: 'alarm-1',
    });
    expect(result).toEqual({ id: 'alarm-1', classification: 'critical' });
  });

  it('makes both outbound calls inside the caller trace scope', async () => {
    const observed: (string | undefined)[] = [];
    classifier.send.mockImplementation(() => {
      observed.push(traceContext.getTraceId());
      return of({ id: 'alarm-1', classification: 'critical' });
    });
    notifications.emit.mockImplementation(() => {
      observed.push(traceContext.getTraceId());
      return of(undefined);
    });

    await traceContext.run('trace-1', () =>
      controller.createAlarm({ name: 'smoke', buildingId: 1 }),
    );

    expect(observed).toEqual(['trace-1', 'trace-1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest apps/alarms-service`
Expected: FAIL — `AlarmsServiceController` still takes `ClientProxy` and constructs its own `Logger`, so the three-argument constructor call does not compile.

- [ ] **Step 3: Rewrite the module**

Replace the whole of `apps/alarms-service/src/alarms-service.module.ts` with:

```ts
import { NatsClientModule, RmqClientModule, TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { AlarmsServiceController } from './alarms-service.controller';
import { AlarmsServiceService } from './alarms-service.service';
import { ALARMS_CLASSIFIER_SERVICE, NOTIFICATIONS_SERVICE } from './constants';

@Module({
  imports: [
    TracingModule,
    NatsClientModule.register([
      { name: ALARMS_CLASSIFIER_SERVICE, queue: 'alarms-classifier-service' },
    ]),
    RmqClientModule.register([
      { name: NOTIFICATIONS_SERVICE, queue: 'notifications-service' },
    ]),
  ],
  controllers: [AlarmsServiceController],
  providers: [AlarmsServiceService],
})
export class AlarmsServiceModule {}
```

- [ ] **Step 4: Rewrite the controller**

Replace the whole of `apps/alarms-service/src/alarms-service.controller.ts` with:

```ts
import { type TracingClientProxy, TracingLogger } from '@app/tracing';
import { Controller, Inject } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { ALARMS_CLASSIFIER_SERVICE, NOTIFICATIONS_SERVICE } from './constants';

@Controller()
export class AlarmsServiceController {
  constructor(
    private readonly logger: TracingLogger,
    @Inject(ALARMS_CLASSIFIER_SERVICE)
    private readonly alarmsClassifierService: TracingClientProxy,
    @Inject(NOTIFICATIONS_SERVICE)
    private readonly notificationsService: TracingClientProxy,
  ) {}

  @EventPattern('alarms.create')
  async createAlarm(@Payload() alarm: { name: string; buildingId: number }) {
    this.logger.log(`Creating alarm: ${JSON.stringify(alarm)}`);
    const classification = await lastValueFrom<{
      id: string;
      classification: string;
    }>(this.alarmsClassifierService.send('alarms.classify', alarm));
    this.logger.log(`Alarm classified: ${JSON.stringify(classification)}`);

    await lastValueFrom(
      this.notificationsService.emit('notifications.create', {
        alarmId: classification.id,
      }),
    );
    this.logger.log(
      `Notification created: ${JSON.stringify({ alarmId: classification.id })}`,
    );
    return classification;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn jest apps/alarms-service`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verify the module graph actually boots**

Run: `yarn build alarms-service`
Expected: exit 0, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/alarms-service
git commit -m "feat(alarms-service): propagate trace ids through nats and rmq hops"
```

---

### Task 9: Wire alarms-classifier-service

**Files:**
- Modify: `apps/alarms-classifier-service/src/alarms-classifier.module.ts` (full rewrite, 10 lines)
- Modify: `apps/alarms-classifier-service/src/alarms-classifier.controller.ts` (full rewrite, 23 lines)
- Modify: `apps/alarms-classifier-service/src/alarms-classifier.controller.spec.ts` (full rewrite, 29 lines)

**Interfaces:**
- Consumes: `TracingModule`, `TracingLogger`.
- Produces: nothing for later tasks.

This service only receives, so it needs no client module — just the global `TracingModule` (whose `APP_INTERCEPTOR` opens the scope from the inbound NATS headers) and the trace-aware logger.

- [ ] **Step 1: Rewrite the existing test**

Replace the whole of `apps/alarms-classifier-service/src/alarms-classifier.controller.spec.ts` with:

```ts
import { TraceContextService, TraceService, TracingLogger } from '@app/tracing';
import { Logger } from '@nestjs/common';
import { AlarmsClassifierController } from './alarms-classifier.controller';
import { AlarmsClassifierService } from './alarms-classifier.service';

describe('AlarmsClassifierController', () => {
  let traceContext: TraceContextService;
  let controller: AlarmsClassifierController;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    controller = new AlarmsClassifierController(
      new TracingLogger('AlarmsClassifierController', traceContext),
      new AlarmsClassifierService(),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('classifies an alarm with an id and a known severity', () => {
    const result = controller.classifyAlarm({ name: 'smoke', buildingId: 1 });

    expect(result.id).toMatch(/^alarm-/);
    expect(['critical', 'major', 'minor', 'warning', 'info']).toContain(
      result.classification,
    );
  });

  it('logs the inbound trace id', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    traceContext.run('trace-1', () =>
      controller.classifyAlarm({ name: 'smoke', buildingId: 1 }),
    );

    expect(logSpy).toHaveBeenCalledWith(
      '[trace:trace-1] Classifying alarm: {"name":"smoke","buildingId":1}',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest apps/alarms-classifier-service`
Expected: FAIL — the controller constructor currently takes only `AlarmsClassifierService`.

- [ ] **Step 3: Rewrite the module**

Replace the whole of `apps/alarms-classifier-service/src/alarms-classifier.module.ts` with:

```ts
import { TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { AlarmsClassifierController } from './alarms-classifier.controller';
import { AlarmsClassifierService } from './alarms-classifier.service';

@Module({
  imports: [TracingModule],
  controllers: [AlarmsClassifierController],
  providers: [AlarmsClassifierService],
})
export class AlarmsClassifierModule {}
```

- [ ] **Step 4: Rewrite the controller**

Replace the whole of `apps/alarms-classifier-service/src/alarms-classifier.controller.ts` with:

```ts
import { TracingLogger } from '@app/tracing';
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AlarmsClassifierService } from './alarms-classifier.service';

@Controller()
export class AlarmsClassifierController {
  constructor(
    private readonly logger: TracingLogger,
    private readonly alarmsClassifierService: AlarmsClassifierService,
  ) {}

  @MessagePattern('alarms.classify')
  classifyAlarm(@Payload() alarm: { name: string; buildingId: number }) {
    this.logger.log(`Classifying alarm: ${JSON.stringify(alarm)}`);

    return {
      id: 'alarm-' + Math.random().toString(36).substring(2, 10),
      classification: ['critical', 'major', 'minor', 'warning', 'info'][
        Math.floor(Math.random() * 5)
      ],
    };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn jest apps/alarms-classifier-service`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/alarms-classifier-service
git commit -m "feat(alarms-classifier-service): log the inbound trace id"
```

---

### Task 10: Wire notifications-service

**Files:**
- Modify: `apps/notifications-service/src/notifications.module.ts` (full rewrite, 10 lines)
- Modify: `apps/notifications-service/src/notifications.controller.ts` (full rewrite, 31 lines)
- Modify: `apps/notifications-service/src/notifications.controller.spec.ts` (full rewrite, 49 lines)

**Interfaces:**
- Consumes: `TracingModule`, `TracingLogger`.
- Produces: nothing for later tasks.

Leave the existing ack/nack redelivery behaviour exactly as it is — it is out of scope. A useful side effect of header-based propagation is that a redelivered message keeps its original trace id, so the retry is visibly part of the same flow.

- [ ] **Step 1: Rewrite the existing test**

Replace the whole of `apps/notifications-service/src/notifications.controller.spec.ts` with:

```ts
import { TraceContextService, TraceService, TracingLogger } from '@app/tracing';
import { RmqContext } from '@nestjs/microservices';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let traceContext: TraceContextService;
  let controller: NotificationsController;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    controller = new NotificationsController(
      new TracingLogger('NotificationsController', traceContext),
      new NotificationsService(),
    );
  });

  function contextWith(redelivered: boolean): {
    context: RmqContext;
    channel: { ack: jest.Mock; nack: jest.Mock };
    message: { fields: { redelivered: boolean } };
  } {
    const channel = { ack: jest.fn(), nack: jest.fn() };
    const message = { fields: { redelivered } };
    const context = {
      getChannelRef: () => channel,
      getMessage: () => message,
    } as unknown as RmqContext;
    return { context, channel, message };
  }

  it('acks a redelivered notification without nacking', () => {
    const { context, channel, message } = contextWith(true);

    controller.createNotification({ alarmId: 'a1' }, context);

    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks a first delivery so it can be requeued', () => {
    const { context, channel, message } = contextWith(false);

    controller.createNotification({ alarmId: 'a1' }, context);

    expect(channel.nack).toHaveBeenCalledWith(message);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest apps/notifications-service`
Expected: FAIL — the controller constructor currently takes only `NotificationsService`.

- [ ] **Step 3: Rewrite the module**

Replace the whole of `apps/notifications-service/src/notifications.module.ts` with:

```ts
import { TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [TracingModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 4: Rewrite the controller**

Replace the whole of `apps/notifications-service/src/notifications.controller.ts` with:

```ts
import { TracingLogger } from '@app/tracing';
import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { Channel, Message } from 'amqplib';
import { NotificationsService } from './notifications.service';

@Controller()
export class NotificationsController {
  constructor(
    private readonly logger: TracingLogger,
    private readonly notificationsService: NotificationsService,
  ) {}

  @EventPattern('notifications.create')
  createNotification(
    @Payload() notification: { alarmId: string },
    @Ctx() context: RmqContext,
  ) {
    this.logger.log(`Creating notification: ${JSON.stringify(notification)}`);
    const channel = context.getChannelRef() as Channel;
    const originalMessage = context.getMessage() as Message;

    if (originalMessage.fields.redelivered) {
      this.logger.log('Notification already processed, skipping');
      channel.ack(originalMessage);
      return;
    }

    this.logger.log('Notification not processed, requeuing');
    channel.nack(originalMessage);
    return;
  }
}
```

Note the `this.logger.log('--------------------------------')` separator line from the original is dropped — the trace id prefix now groups related lines.

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn jest apps/notifications-service`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/notifications-service
git commit -m "feat(notifications-service): log the inbound trace id"
```

---

### Task 11: Wire alarms-generator as the trace origin

**Files:**
- Modify: `apps/alarms-generator/src/alarms-generator.module.ts` (full rewrite, 24 lines)
- Modify: `apps/alarms-generator/src/alarms-generator.service.ts` (full rewrite, 19 lines)
- Test: `apps/alarms-generator/src/alarms-generator.service.spec.ts` (create)

**Interfaces:**
- Consumes: `TracingModule`, `TracingLogger`, `TraceContextService.runWithNewTrace()`, `NatsClientModule.register()`, `TracingClientProxy`.
- Produces: nothing for later tasks.

This is the only place a trace is born without an inbound message. `@Interval` fires outside any Nest execution context, so the interceptor never runs here and `runWithNewTrace()` opens the scope explicitly. The `@Interval(10000)` decorator is currently commented out at `apps/alarms-generator/src/alarms-generator.service.ts:11`; this task enables it, which turns the whole pipeline on.

- [ ] **Step 1: Write the failing test**

Create `apps/alarms-generator/src/alarms-generator.service.spec.ts`:

```ts
import { TraceContextService, TraceService, TracingLogger } from '@app/tracing';
import { of } from 'rxjs';
import { AlarmsGeneratorService } from './alarms-generator.service';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('AlarmsGeneratorService', () => {
  let traceContext: TraceContextService;
  let observedTraceIds: (string | undefined)[];
  let client: { send: jest.Mock; emit: jest.Mock };
  let service: AlarmsGeneratorService;

  beforeEach(() => {
    traceContext = new TraceContextService(new TraceService());
    observedTraceIds = [];
    client = {
      send: jest.fn(),
      emit: jest.fn(() => {
        observedTraceIds.push(traceContext.getTraceId());
        return of(undefined);
      }),
    };
    service = new AlarmsGeneratorService(
      new TracingLogger('AlarmsGeneratorService', traceContext),
      traceContext,
      client,
    );
  });

  it('emits an alarm with a name and a building id', async () => {
    await service.generateAlarms();

    expect(client.emit).toHaveBeenCalledWith('alarms.create', {
      name: expect.stringMatching(/^Alarm #/),
      buildingId: expect.any(Number),
    });
  });

  it('emits inside a freshly generated trace scope', async () => {
    await service.generateAlarms();

    expect(observedTraceIds[0]).toMatch(UUID_V4);
  });

  it('starts a new trace on every interval tick', async () => {
    await service.generateAlarms();
    await service.generateAlarms();

    expect(observedTraceIds[1]).not.toBe(observedTraceIds[0]);
  });

  it('leaves no trace scope open after the tick finishes', async () => {
    await service.generateAlarms();

    expect(traceContext.getTraceId()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn jest apps/alarms-generator`
Expected: FAIL — the service constructor currently takes only the `ClientProxy`.

- [ ] **Step 3: Rewrite the module**

Replace the whole of `apps/alarms-generator/src/alarms-generator.module.ts` with:

```ts
import { NatsClientModule, TracingModule } from '@app/tracing';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ALARMS_SERVICE } from '../constants';
import { AlarmsGeneratorService } from './alarms-generator.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TracingModule,
    NatsClientModule.register([
      { name: ALARMS_SERVICE, queue: 'alarms-service' },
    ]),
  ],
  controllers: [],
  providers: [AlarmsGeneratorService],
})
export class AlarmsGeneratorModule {}
```

- [ ] **Step 4: Rewrite the service**

Replace the whole of `apps/alarms-generator/src/alarms-generator.service.ts` with:

```ts
import {
  TraceContextService,
  type TracingClientProxy,
  TracingLogger,
} from '@app/tracing';
import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { lastValueFrom } from 'rxjs';
import { ALARMS_SERVICE } from '../constants';

@Injectable()
export class AlarmsGeneratorService {
  constructor(
    private readonly logger: TracingLogger,
    private readonly traceContext: TraceContextService,
    @Inject(ALARMS_SERVICE)
    private readonly alarmsService: TracingClientProxy,
  ) {}

  // Interval ticks run outside any Nest execution context, so this is where a
  // trace is born rather than inherited from an inbound message.
  @Interval(10000)
  generateAlarms(): Promise<void> {
    return this.traceContext.runWithNewTrace(async () => {
      const alarm = {
        name: 'Alarm #' + Math.random().toString(36).substring(2, 10),
        buildingId: Math.floor(Math.random() * 1000) + 1,
      };
      this.logger.log(`Generating alarm: ${JSON.stringify(alarm)}`);
      await lastValueFrom(this.alarmsService.emit('alarms.create', alarm));
    });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn jest apps/alarms-generator`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/alarms-generator
git commit -m "feat(alarms-generator): start a new trace on every interval tick"
```

---

### Task 12: Full verification

**Files:**
- No production files. Fix anything these commands surface.

**Interfaces:**
- Consumes: everything from Tasks 1-11.
- Produces: nothing.

- [ ] **Step 1: Run the whole unit suite**

Run: `yarn test`
Expected: PASS. All pre-existing suites still green, plus the new tracing suites.

- [ ] **Step 2: Lint**

Run: `yarn lint`
Expected: exit 0.

- [ ] **Step 3: Build every touched app**

```bash
yarn build alarms-generator && \
yarn build alarms-service && \
yarn build alarms-classifier-service && \
yarn build notifications-service
```

Expected: exit 0 for each, no TypeScript errors.

- [ ] **Step 4: Bring the pipeline up**

```bash
docker compose up -d --build nats-server rabbitmq alarms-generator alarms-service alarms-classifier-service notifications-service
```

Expected: all six containers reach a running state.

- [ ] **Step 5: Confirm one trace id spans all four services**

Wait ~20 seconds for two interval ticks, then:

```bash
docker compose logs --no-color alarms-generator alarms-service alarms-classifier-service notifications-service \
  | grep -o 'trace:[0-9a-f-]*' | sort | uniq -c | sort -rn | head
```

Expected: the most frequent trace id appears many times. Pick it and confirm it crosses every service — the generator hop (NATS), the classifier hop (NATS `send`), and the notification hop (RabbitMQ `emit`):

```bash
TRACE=<paste the id>
docker compose logs --no-color alarms-generator alarms-service alarms-classifier-service notifications-service \
  | grep "$TRACE"
```

Expected output contains, all carrying the same `[trace:<id>]` prefix:
- `alarms-generator` — `Generating alarm: {...}` and `[nats] emit alarms.create`
- `alarms-service` — `Creating alarm: {...}`, `[nats] send alarms.classify`, `Alarm classified: {...}`, `[rmq] emit notifications.create`
- `alarms-classifier-service` — `Classifying alarm: {...}`
- `notifications-service` — `Creating notification: {...}`

- [ ] **Step 6: Confirm concurrent flows do not bleed into each other**

```bash
docker compose logs --no-color alarms-service | grep -c 'trace:'
docker compose logs --no-color alarms-service | grep -o 'trace:[0-9a-f-]*' | sort -u | wc -l
```

Expected: the number of distinct trace ids equals the number of interval ticks that have fired, and each id appears exactly five times in `alarms-service` — three from `createAlarm` itself plus one from each proxy hop (`[nats] send`, `[rmq] emit`). Any id appearing a different number of times means scope leakage.

- [ ] **Step 7: Tear down**

```bash
docker compose down
```

- [ ] **Step 8: Commit anything the verification forced you to change**

```bash
git add -A
git commit -m "chore(tracing): verification fixes"
```

---

## Verified Assumptions

These were checked against the installed packages before the plan was written; do not re-litigate them, but do re-check if a dependency is upgraded mid-implementation.

| Assumption | How it was verified |
|---|---|
| `INQUIRER` resolves inside a factory provider's `inject` array, not just constructor params | `node_modules/@nestjs/core/injector/injector.js:136` — `resolveConstructorParams` checks `isInquirer(param, parentInquirer)` on the same code path for both `getFactoryProviderDependencies` and `getClassDependencies` |
| `INQUIRER` is importable from `@nestjs/core` | re-exported via `injector/index.d.ts` → `inquirer/inquirer-constants.d.ts`; confirmed at runtime |
| `ClientsModule.register` wires up connection teardown | `module/clients.module.js` — `assignOnAppShutdownHook` sets `client.onApplicationShutdown = client.close` |
| `nats` `MsgHdrs.get()` returns `''` for a missing key | confirmed at runtime against `nats@2.29.3` |
| `ClientProviderOptions`, `NatsRecord`, `RmqRecord` are all public exports of `@nestjs/microservices` | `module/interfaces/clients-module.interface.d.ts` and `record-builders/index.d.ts` |
| The refactored client plumbing typechecks — the union-typed `ClientProviderOptions` returned from the contextually-typed `clientOptions` callback, `useFactory: createProxy` against the `inject` array, the abstract base's generic `send`/`emit`, and the `record.options?.headers` spread | `tsc --noEmit` over a scratch file containing all of Tasks 6-7 plus a sample consumer module; exit 0 |
| Node 20 supplies `node:crypto` `randomUUID` and `node:async_hooks` `AsyncLocalStorage` | `Dockerfile` pins `node:20-alpine` |
| `@nestjs/schedule` refuses to register `@Interval` on a non-static dependency tree | `schedule.explorer.js:49`, plus a probe module run against this repo's dependencies |
| `CONTEXT` from `@nestjs/microservices` is the same token as `REQUEST`, and exposes the transport context via `RequestContextHost.getContext()` | `microservices/tokens.d.ts` (`CONTEXT = "REQUEST"`), `context/request-context-host.d.ts` |

## Deliberate Non-Goals

- `virtual-facility`, `workflows-service`, `libs/inbox`, and `libs/outbox` are untouched. Adding tracing there is a follow-up: `virtual-facility` would import `TracingModule` and swap its `ClientsModule.register` for `RmqClientModule.register`, and `OutboxProcessor` would wrap each `dispatchWorkflowEvent` in `runWithNewTrace` (its existing `RmqRecord` usage is already handled by the merge branch in `RmqClientProxy`).
- No span/parent-span hierarchy, no sampling, no OpenTelemetry exporter. A single flat trace id is what the current logging needs; adding span structure later means extending `TraceStore`, and every consumer already goes through `TraceContextService`.
- The notifications-service nack-then-redeliver behaviour is preserved as-is.
