# Inbox Pattern Design

**Date:** 2026-09-10  
**Status:** Approved for spec review  
**Node:** 20 (Dockerfile `node:20-alpine`)  
**NestJS:** 11

## Goal

Guarantee that RabbitMQ messages consumed by `workflows-service` are persisted first, acknowledged immediately, and processed **at most once** even when multiple service replicas run. The inbox table is the idempotency log and the work queue. BullMQ only schedules a repeatable processing tick.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Queue / scheduler | BullMQ repeatable job (learn BullMQ) |
| Idempotency | Inbox table unique `messageId` |
| Processor | Repeatable BullMQ job claims `pending` rows; inbox stays the work queue |
| Message identity | AMQP `messageId` set by outbox: `outbox:{outboxRow.id}` |
| Retry | `attempts` + `failed` after cap **3** |
| Row claim | `SELECT … FOR UPDATE SKIP LOCKED` in the same DB transaction as the handler + status update |
| Library shape | Fat `libs/inbox` (entity, service, BullMQ worker, Redis config, handler map) |
| Event types | Inbox is generic; not hardcoded to `workflows.create` |
| RMQ ack | `noAck: false`; ack after successful persist (or duplicate/missing id); do not ack on store failure |

## Architecture

```
virtual-facility                    RMQ                     workflows-service (×3)
outbox row ──emit(messageId)──► workflows.create ──► InboxService.store
                                                     channel.ack (noAck: false)

Redis (BullMQ)                       Postgres (workflows DB)
repeat every 10s ──► worker ──► per row, one transaction:
                                  claim pending SKIP LOCKED
                                  handlers[row.type](payload, entityManager)
                                  mark processed
                                  OR attempts++ / failed at 3
```

- The RMQ consumer does **not** call `WorkflowsService.create`.
- Duplicate RMQ delivery: unique `messageId` → insert conflict → ack, no second row.
- Duplicate processing: `SKIP LOCKED` + status; `processed` / `failed` rows are never claimed.
- One logical message: handler side effect + inbox `processed` in **one transaction** (handler receives the same `EntityManager`). If the handler throws, that transaction does not keep the side effect.

## Components

### Inbox entity (`libs/inbox`)

Table `inbox`:

| Column | Type | Rules |
|---|---|---|
| `id` | number, PK, generated | |
| `messageId` | string | **unique**; e.g. `outbox:42` |
| `type` | string | Event name, e.g. `workflows.create`. Not an enum. |
| `payload` | jsonb | Event body |
| `status` | enum | `pending` (default) \| `processed` \| `failed` |
| `attempts` | int | default `0` |
| `lastError` | text, nullable | Last handler/dispatch error |
| `createdAt` / `updatedAt` | timestamps | |

Unique idempotency key is `messageId` alone (publisher-wide), not `(type, payload)`.

### InboxService

- `store({ messageId, type, payload })`: insert. Unique violation means already stored; return without throwing to the consumer.
- `claimPending({ take, maxAttempts, manager })`: `WHERE status = 'pending' AND attempts < maxAttempts ORDER BY createdAt ASC LIMIT take FOR UPDATE SKIP LOCKED`.
- `markProcessed(id, manager)`: `status = 'processed'`.
- `recordFailure(id, error, { maxAttempts }, manager)`: `attempts += 1`, set `lastError`; if `attempts >= maxAttempts` then `status = 'failed'`, else stay `pending`.

Claim/mark/failure that participate in processing **must** use the transaction `EntityManager`, not a separate connection.

### InboxProcessor (BullMQ, inside the lib)

- Queue name: `inbox`.
- On module init, add a repeatable job: `every: 10_000` ms, stable `jobId: 'inbox-process-pending'` so all replicas share one schedule in Redis.
- Batch: up to `take: 100` rows per tick.
- **One transaction per row**, never one transaction for the whole batch (a later failure must not roll back an earlier successful create).
- Each iteration: `BEGIN` → `claimPending({ take: 1 })` (`FOR UPDATE SKIP LOCKED`) → if no row, stop the tick → dispatch → `COMMIT`. Repeat until `take` or no row.
- Dispatch: `const handler = handlers[row.type]`.
  - If missing: do not call any business service; in that same transaction set `lastError = 'no handler for {type}'` and `status = 'failed'` (retry cannot help).
  - If present: `await handler(row.payload, entityManager)` then `markProcessed` in **that same transaction**.
- Handler throw: **roll back the processing transaction** (workflow insert and inbox changes from that TX are discarded). Then a **second** transaction loads the same row by `id` and calls `recordFailure`. Do not catch-and-commit inside the processing transaction — that would persist the handler’s side effects together with `attempts++`.
- Per-row try/catch around that sequence: one poison row does not abort the rest of the tick.
- Job-level throw: BullMQ may retry the tick; row locks release on rollback so rows stay `pending`.

### InboxModule (fat, global)

`InboxModule.registerAsync({ imports, inject, useFactory })` returns options:

```ts
{
  redis: { host: string, port: number }, // host default 'redis', port 6379
  repeatEveryMs: 10000,
  take: 100,
  maxAttempts: 3,
  handlers: Record<string, (payload: unknown, em: EntityManager) => Promise<void>>,
}
```

- Owns `TypeOrmModule.forFeature([Inbox])`, `BullModule.forRoot` / `registerQueue({ name: 'inbox' })`, `InboxService`, `InboxProcessor`.
- `@Global()` and exports `InboxService` so `WorkflowsController` can inject it.
- New dependencies: `@nestjs/bullmq`, `bullmq`, `ioredis`. Compatible with Node 20.

Public exports from `libs/inbox`: entity, module, service, handler function type.

### workflows-service

**`main.ts`:** RMQ options include `noAck: false`.

**`WorkflowsController.create` (`workflows.create`):**

1. Read AMQP `messageId` from `RmqContext` (`message.properties.messageId`).
2. If missing: log error, `ack`, return (do not insert; avoids a poison requeue loop).
3. `await inboxService.store({ messageId, type: 'workflows.create', payload })`.
4. `channel.ack(originalMessage)`.
5. On unique/duplicate: still `ack`.
6. On other store errors: **do not ack** (RMQ redelivers).
7. Do **not** call `workflowsService.create` here.

Adding another event later: new `@EventPattern('other.event')` that calls `store` with `type: 'other.event'`, plus a new `handlers` map entry. No inbox schema change.

**`WorkflowsService.create(dto, manager?: EntityManager)`:** when `manager` is passed, save `Workflow` through `manager.getRepository(Workflow)` so it shares the inbox transaction. HTTP/other callers omit `manager` and use the injected repository.

**`WorkflowsServiceModule`:** import `InboxModule.registerAsync` once. `useFactory` injects `WorkflowsService` (via `imports: [WorkflowsModule]`) and registers:

```ts
handlers: {
  'workflows.create': (payload, em) =>
    workflowsService.create(payload as CreateWorkflowDto, em),
}
```

`WorkflowsModule` exports `WorkflowsService`. It does not import `InboxModule` (parent registers it globally).

### Outbox publisher

`OutboxProcessor.dispatchWorkflowEvent` emits with Nest `RmqRecordBuilder`:

- payload = outbox `payload`
- options `messageId` = `outbox:${message.id}`

Without this, inbox cannot idempotently key RMQ redeliveries.

### Infrastructure

`docker-compose.yml`:

- New `redis` service (image `redis:7-alpine` is sufficient).
- `workflows-service`: `REDIS_HOST=redis`, `depends_on` includes `redis`.
- Existing `deploy.replicas: 3` stays; SKIP LOCKED + unique `messageId` + shared BullMQ repeatable job make that safe.

## Data flow (happy path)

1. `virtual-facility` commits building + outbox row in one transaction.
2. Outbox processor emits `workflows.create` with `messageId: outbox:{id}`.
3. A `workflows-service` replica stores an inbox row (`pending`, `type: workflows.create`) and acks RMQ.
4. Within 10 seconds, one worker runs the repeatable job.
5. It claims the row with `SKIP LOCKED`, creates the workflow and marks `processed` in one transaction.

## Error handling

| Situation | Behavior |
|---|---|
| Store succeeds | `ack` |
| Duplicate `messageId` | already stored; `ack` |
| Missing `messageId` | log; `ack`; no insert |
| Store fails (DB down, etc.) | do not ack; RMQ redelivers |
| Handler succeeds | same TX: side effect + `processed` |
| Handler throws, `attempts` after increment `< 3` | processing TX rolled back (no workflow row); second TX: `attempts++`, stay `pending`, set `lastError` |
| Handler throws, `attempts` reaches 3 | processing TX rolled back; second TX: `status = failed`; skipped on later ticks |
| No handler for `row.type` | `failed` immediately; `lastError = no handler for {type}` |
| Overlapping ticks / 3 replicas | `FOR UPDATE SKIP LOCKED` |
| Repeatable job throws | BullMQ retries the tick; locks released; rows stay `pending` |
| Event type with no `@EventPattern` | never stored (not consumed) |

Statuses are only `pending | processed | failed`. There is no `processing` column; the row lock is the in-flight claim.

## Testing

Jest, existing `*.spec.ts` style. Node 20.

- `InboxService.store`: inserts a row; duplicate `messageId` is treated as already stored (consumer does not see a throw).
- `claimPending`: pending, `attempts < maxAttempts`, `SKIP LOCKED`, `take`.
- Processor: matching handler is invoked with the same `EntityManager`; row becomes `processed`.
- Processor: handler throw → `attempts` 1 and `pending`; third failure → `failed`.
- Processor: unknown `type` → `failed`; no handler function called.
- Processor: two registered types dispatch to the matching handler (`workflows.create` vs a second test handler).
- Controller: `ack` after store; `ack` on duplicate; no `ack` on store error; does not call `create`.
- `OutboxProcessor`: emit record includes `messageId: outbox:{id}`.

## Out of scope

- Inbox in services other than `workflows-service`
- BullMQ board / dashboard
- Dead-letter queue beyond status `failed`
- Distributed locking for the existing **outbox** processor
- Changing HTTP workflow CRUD behavior except `create` accepting an optional `EntityManager`

## File map

**Create**

- `libs/inbox/src/entities/inbox.entity.ts`
- `libs/inbox/src/inbox.service.ts`
- `libs/inbox/src/inbox.processor.ts`
- `libs/inbox/src/inbox.module.ts`
- `libs/inbox/src/inbox.constants.ts`
- `libs/inbox/src/inbox.types.ts`
- `libs/inbox/src/index.ts`
- `libs/inbox/tsconfig.lib.json`
- `libs/inbox/src/inbox.service.spec.ts`
- `libs/inbox/src/inbox.processor.spec.ts`

**Modify**

- `nest-cli.json` — add `inbox` project
- `tsconfig.json` — `@app/inbox` paths
- `package.json` — deps + Jest `moduleNameMapper`
- `docker-compose.yml` — Redis + `REDIS_HOST`
- `apps/workflows-service/src/main.ts` — `noAck: false`
- `apps/workflows-service/src/workflows/workflows.controller.ts` — store + ack
- `apps/workflows-service/src/workflows/workflows.service.ts` — optional `EntityManager`
- `apps/workflows-service/src/workflows/workflows.module.ts` — export `WorkflowsService`
- `apps/workflows-service/src/workflows-service.module.ts` — `InboxModule.registerAsync`
- `apps/workflows-service/src/workflows/workflows.controller.spec.ts`
- `libs/outbox/src/outbox.processor.ts` — `RmqRecordBuilder` + `messageId`
- `libs/outbox/src/outbox.processor.spec.ts` — create; assert emit uses `messageId: outbox:{id}`
