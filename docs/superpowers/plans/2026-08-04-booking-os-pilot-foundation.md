# Booking OS Pilot Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Booking OS foundation so tenant-scoped vertical slices can be built safely with verified sessions, RLS, observability, inbox/outbox, and CI gates.

**Architecture:** Extend the existing NestJS API, Next.js BFF applications, PostgreSQL/Redis runtime, and critical worker without introducing domain features. Establish request context and tenant context as explicit infrastructure, use PostgreSQL RLS as the final isolation boundary, and persist outbox/inbox records transactionally for idempotent worker processing.

**Tech Stack:** Node.js 22, pnpm 10.34.5, TypeScript 5.9.3, NestJS 11.1.28, Next.js 16.2.12, PostgreSQL, Prisma, Redis, BullMQ, Zod 4.4.3, Vitest/Node test runner, Supertest, Playwright.

## Global Constraints

- Work on a new implementation branch created from `docs/booking-os-pilot-design` after this plan is approved.
- Preserve the dependency direction `applications -> shared packages -> contracts/typescript-config`.
- Browser code must not store an access token or call privileged NestJS endpoints directly.
- Do not trust `tenantId`, `partnerId`, role, or permission values supplied by browser payloads or headers.
- Every tenant-owned table must include `tenant_id` and use PostgreSQL `FORCE ROW LEVEL SECURITY`.
- Background jobs must carry explicit tenant scope.
- Redis is not the source of truth for confirmed bookings or finance.
- Do not log secrets, OTP values, KYC content, or full bank-account values.
- Every durable side effect must be idempotent.
- Use TDD: failing test, observed failure, minimal implementation, passing test, commit.
- Pin dependency versions exactly and update `pnpm-lock.yaml` when manifests change.

## File Map

- `apps/api/src/config/`: fail-fast environment validation.
- `apps/api/src/health/`: liveness and readiness endpoints.
- `apps/api/src/common/request-context/`: request/trace IDs and structured request context.
- `apps/api/src/common/errors/`: standard API error envelope.
- `apps/api/src/tenancy/`: host/session-derived tenant context and guards.
- `apps/api/prisma/`: Prisma schema, migrations, RLS policies, and seed fixtures.
- `apps/api/src/reliability/`: transactional inbox/outbox records and dispatch interfaces.
- `apps/worker-critical/src/outbox/`: outbox polling and idempotent dispatch.
- `apps/web-console/src/lib/session/`: server-only opaque session BFF proof.
- `apps/web-storefront/src/lib/tenant/`: public host-to-tenant resolution proof.
- `packages/contracts/src/`: request context, error envelope, health/readiness contracts.
- `packages/testing/src/`: tenant fixtures and integration helpers.
- `.github/workflows/ci.yml`: foundation quality gates.
- `docs/runbooks/`: recovery and operations instructions.

---

### Task 1: Make environment loading fail fast

**Files:**
- Modify: `apps/api/src/config/environment.service.ts`
- Modify: `apps/api/src/config/environment.service.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json`
- Modify: `.env.example`
- Modify: `.env.docker.example`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `EnvironmentService.databaseUrl`, `redisUrl`, `sessionSecret`, `apiPrefix`, `host`, `port`, `nodeEnvironment`.
- Produces: `parseApiEnvironment(input: NodeJS.ProcessEnv): ApiEnvironment`.

- [ ] **Step 1: Write failing environment tests**

Add tests proving required values and production restrictions:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { parseApiEnvironment } from "./environment.service.js";

const base = {
  NODE_ENV: "test",
  API_HOST: "127.0.0.1",
  API_PORT: "3001",
  API_PREFIX: "v1",
  DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
};

test("rejects missing database URL", () => {
  assert.throws(
    () => parseApiEnvironment({ ...base, DATABASE_URL: undefined }),
    /DATABASE_URL/,
  );
});

test("rejects short session secret", () => {
  assert.throws(
    () => parseApiEnvironment({ ...base, SESSION_SECRET: "short" }),
    /SESSION_SECRET/,
  );
});

test("rejects mock payment in production", () => {
  assert.throws(
    () => parseApiEnvironment({ ...base, NODE_ENV: "production", PAYMENT_PROVIDER: "mock" }),
    /PAYMENT_PROVIDER/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
pnpm --filter @booking-os/api test -- src/config/environment.service.test.ts
```

Expected: FAIL because `parseApiEnvironment` and required properties are absent.

- [ ] **Step 3: Implement the Zod schema**

Use one exported parser:

```ts
const apiEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_HOST: z.string().min(1).default("0.0.0.0"),
    API_PORT: z.coerce.number().int().positive().max(65535).default(3001),
    API_PREFIX: z.string().regex(/^[a-z0-9-]+$/).default("v1"),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32),
    PAYMENT_PROVIDER: z.enum(["mock", "payos"]).default("mock"),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && value.PAYMENT_PROVIDER === "mock") {
      context.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message: "PAYMENT_PROVIDER cannot be mock in production",
      });
    }
  });
```

Expose typed getters only. Parse before creating the Nest application so invalid production configuration cannot start listening.

- [ ] **Step 4: Update environment examples**

Add exact keys with non-secret placeholders:

```dotenv
DATABASE_URL=postgresql://booking:booking@localhost:5432/booking
REDIS_URL=redis://localhost:6379
SESSION_SECRET=replace-with-at-least-32-random-characters
PAYMENT_PROVIDER=mock
```

- [ ] **Step 5: Run verification**

```bash
pnpm --filter @booking-os/api lint
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api build
```

Expected: all commands pass; starting with a missing required value exits non-zero before binding a port.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config apps/api/src/main.ts apps/api/package.json .env.example .env.docker.example pnpm-lock.yaml
git commit -m "feat(api): validate runtime environment at startup"
```

---

### Task 2: Add liveness, readiness, and graceful shutdown

**Files:**
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.service.ts`
- Modify: `apps/api/src/health/health.module.ts`
- Create: `apps/api/src/health/readiness-checker.ts`
- Modify: `apps/api/src/health/health.controller.test.ts`
- Modify: `apps/api/test/health.e2e.test.ts`
- Modify: `packages/contracts/src/health.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- Produces: `GET /v1/health` for liveness.
- Produces: `GET /v1/ready` for dependency readiness.
- Produces: `ReadinessChecker.check(): Promise<ReadinessResult>`.

- [ ] **Step 1: Write failing controller and E2E tests**

```ts
test("GET /v1/health is independent of dependencies", async () => {
  await request(app.getHttpServer())
    .get("/v1/health")
    .expect(200)
    .expect(({ body }) => {
      assert.equal(body.status, "ok");
      assert.equal(body.service, "api");
    });
});

test("GET /v1/ready returns 503 when a required dependency is unavailable", async () => {
  readinessChecker.check = async () => ({
    status: "not_ready",
    dependencies: { postgres: "down", redis: "up" },
  });

  await request(app.getHttpServer()).get("/v1/ready").expect(503);
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
```

Expected: readiness route or checker is absent.

- [ ] **Step 3: Implement contracts and readiness checker**

```ts
export type DependencyStatus = "up" | "down";

export interface ReadinessResult {
  readonly status: "ready" | "not_ready";
  readonly dependencies: {
    readonly postgres: DependencyStatus;
    readonly redis: DependencyStatus;
  };
}
```

The production checker must perform bounded checks with a 1-second timeout per dependency. Return HTTP 503 for `not_ready`; never leak connection strings or low-level provider payloads.

- [ ] **Step 4: Add graceful shutdown verification**

Refactor bootstrap to export `createApiApplication()` for tests and keep signal handling in `main.ts`. On shutdown:

```ts
await app.close();
```

Ensure the process stops accepting new requests before closing database, Redis, and queue resources registered with Nest lifecycle hooks.

- [ ] **Step 5: Run verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/contracts --filter=@booking-os/api
pnpm --filter @booking-os/api test:e2e
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/health apps/api/src/main.ts apps/api/test packages/contracts/src
git commit -m "feat(api): add readiness and graceful shutdown"
```

---

### Task 3: Add request context and standard API errors

**Files:**
- Create: `packages/contracts/src/request-context.ts`
- Create: `packages/contracts/src/api-error.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/common/request-context/request-context.types.ts`
- Create: `apps/api/src/common/request-context/request-context.storage.ts`
- Create: `apps/api/src/common/request-context/request-context.middleware.ts`
- Create: `apps/api/src/common/request-context/request-context.module.ts`
- Create: `apps/api/src/common/errors/api-error.ts`
- Create: `apps/api/src/common/errors/api-exception.filter.ts`
- Create: `apps/api/src/common/errors/api-exception.filter.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `packages/observability/src/logger.ts`
- Modify: `packages/observability/tests/logger.test.ts`

**Interfaces:**
- Produces: `RequestContext { requestId, traceId, actorId?, tenantId? }`.
- Produces: `RequestContextStorage.run/get/require`.
- Produces: error envelope `{ error: { code, message, requestId, details? } }`.

- [ ] **Step 1: Write failing context and error tests**

```ts
test("uses valid incoming request ID and creates a trace ID", async () => {
  const response = await request(app.getHttpServer())
    .get("/v1/health")
    .set("x-request-id", "req-client-123")
    .expect(200);

  assert.equal(response.headers["x-request-id"], "req-client-123");
  assert.match(response.headers["x-trace-id"], /^[0-9a-f-]{36}$/);
});

test("maps unexpected errors without leaking stack traces", async () => {
  const result = filter.format(new Error("database password=secret"), "req-1");
  assert.deepEqual(result, {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId: "req-1",
    },
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @booking-os/observability test
pnpm --filter @booking-os/api test
```

- [ ] **Step 3: Implement AsyncLocalStorage context**

```ts
export interface RequestContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly actorId?: string;
  readonly tenantId?: string;
}
```

Accept an incoming request ID only when it matches `^[A-Za-z0-9._:-]{1,128}$`; otherwise generate `randomUUID()`. Always generate or validate a separate trace ID. Return both response headers.

- [ ] **Step 4: Enrich structured logs from context**

Add a context provider option to `createStructuredLogger` so log calls automatically include request and trace IDs without each controller passing them manually. Explicit event context may add fields but must not overwrite protected `timestamp`, `level`, or `message`.

- [ ] **Step 5: Register global middleware and exception filter**

Register the request-context middleware before routes and the exception filter globally. Preserve explicit domain error codes and validation details; redact unexpected exception messages from responses while logging the serialized error server-side.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/contracts --filter=@booking-os/observability --filter=@booking-os/api
pnpm --filter @booking-os/api test:e2e
git add packages/contracts packages/observability apps/api/src/common apps/api/src/app.module.ts apps/api/src/main.ts apps/api/test
git commit -m "feat(observability): propagate request context and API errors"
```

---

### Task 4: Add Prisma, tenant context, and PostgreSQL RLS proof

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260804_foundation/migration.sql`
- Create: `apps/api/prisma/seed.ts`
- Create: `apps/api/src/database/prisma.service.ts`
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/tenancy/tenant-context.ts`
- Create: `apps/api/src/tenancy/tenant-context.service.ts`
- Create: `apps/api/src/tenancy/tenant-resolution.middleware.ts`
- Create: `apps/api/src/tenancy/tenancy.module.ts`
- Create: `apps/api/src/tenancy/tenant-probe.controller.ts`
- Create: `apps/api/test/tenant-isolation.e2e.test.ts`
- Create: `packages/testing/src/tenant-fixture.ts`
- Modify: `packages/testing/src/index.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `TenantContextService.runInTenant<T>(tenantId, work): Promise<T>`.
- Produces: transaction-local PostgreSQL setting `app.tenant_id`.
- Produces: one temporary authenticated tenant-probe route used only for the foundation proof and removed/replaced by real identity in the next plan.

- [ ] **Step 1: Add dependencies and write the failing isolation test**

Add exact versions for Prisma client and CLI. Test two tenants with two rows:

```ts
test("tenant A cannot read tenant B rows", async () => {
  const rowsForA = await tenantContext.runInTenant(TENANT_A, (tx) =>
    tx.tenantProbe.findMany({ orderBy: { id: "asc" } }),
  );

  assert.deepEqual(rowsForA.map((row) => row.tenantId), [TENANT_A]);
});

test("tenant A cannot insert a row owned by tenant B", async () => {
  await assert.rejects(
    tenantContext.runInTenant(TENANT_A, (tx) =>
      tx.tenantProbe.create({ data: { tenantId: TENANT_B, value: "forbidden" } }),
    ),
  );
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm --filter @booking-os/api prisma generate
pnpm --filter @booking-os/api test:e2e -- tenant-isolation.e2e.test.ts
```

Expected: FAIL because schema, client, and RLS do not exist.

- [ ] **Step 3: Create the minimal schema**

```prisma
model Tenant {
  id        String        @id @db.Uuid
  slug      String        @unique
  name      String
  createdAt DateTime      @default(now()) @map("created_at")
  probes    TenantProbe[]

  @@map("tenants")
}

model TenantProbe {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @db.Uuid @map("tenant_id")
  value     String
  createdAt DateTime @default(now()) @map("created_at")
  tenant    Tenant   @relation(fields: [tenantId], references: [id])

  @@index([tenantId])
  @@map("tenant_probes")
}
```

- [ ] **Step 4: Add explicit RLS SQL**

Migration SQL must include:

```sql
ALTER TABLE tenant_probes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_probes FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_probe_isolation ON tenant_probes
USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

The application transaction must execute:

```sql
SELECT set_config('app.tenant_id', $1, true);
```

Do not set tenant context at connection/session scope.

- [ ] **Step 5: Implement tenant transaction API**

```ts
async runInTenant<T>(
  tenantId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return this.prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(transaction);
  });
}
```

Validate tenant IDs as UUIDs before opening the transaction. Public host resolution and authenticated membership resolution must call this service; repositories must not expose the unrestricted root Prisma client for tenant-owned models.

- [ ] **Step 6: Run isolation and migration verification**

```bash
pnpm --filter @booking-os/api prisma validate
pnpm --filter @booking-os/api prisma generate
pnpm --filter @booking-os/api test:e2e -- tenant-isolation.e2e.test.ts
pnpm --filter @booking-os/api lint
pnpm --filter @booking-os/api typecheck
```

Expected: reads, writes, and raw-ID lookup remain isolated.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src/database apps/api/src/tenancy apps/api/test/tenant-isolation.e2e.test.ts apps/api/package.json packages/testing pnpm-lock.yaml
git commit -m "feat(tenancy): enforce PostgreSQL row-level isolation"
```

---

### Task 5: Add the opaque-session BFF proof

**Files:**
- Modify: `packages/auth/src/session.ts`
- Create: `packages/auth/src/opaque-session.ts`
- Modify: `packages/auth/src/index.ts`
- Create: `packages/auth/tests/opaque-session.test.ts`
- Create: `apps/web-console/src/lib/session/session-cookie.ts`
- Create: `apps/web-console/src/lib/session/session-store.ts`
- Create: `apps/web-console/src/app/api/session/route.ts`
- Create: `apps/web-console/src/app/api/session/route.test.ts`
- Create: `apps/web-console/src/middleware.ts`
- Modify: `apps/web-console/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: opaque 256-bit session IDs stored only as SHA-256 hashes server-side.
- Produces: cookie name `booking_os_session`.
- Produces: server-only `SessionStore.create/read/rotate/revoke`.
- Produces: `GET /api/session` returning public session metadata without tokens.

- [ ] **Step 1: Write failing opaque-session tests**

```ts
test("stores only the hash of the presented token", async () => {
  const created = await store.create({ userId: "user-1", tenantId: "tenant-1" });
  assert.equal(created.token.length >= 43, true);
  assert.equal(await repository.hasRawValue(created.token), false);
  assert.equal(await repository.hasHash(hashSessionToken(created.token)), true);
});

test("rotation invalidates the old token", async () => {
  const first = await store.create({ userId: "user-1", tenantId: "tenant-1" });
  const rotated = await store.rotate(first.token);
  assert.equal(await store.read(first.token), null);
  assert.equal((await store.read(rotated.token))?.userId, "user-1");
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm --filter @booking-os/auth test
pnpm --filter @booking-os/web-console test
```

- [ ] **Step 3: Implement token generation and hashing**

```ts
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
```

Cookies:

```ts
{
  httpOnly: true,
  secure: nodeEnvironment === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
}
```

Do not put user, tenant, role, permission, or access-token data in the cookie.

- [ ] **Step 4: Add CSRF proof for mutations**

For non-GET BFF routes, require same-origin `Origin`/`Host` and reject mismatches before forwarding. Add a test that a cross-origin POST returns 403 with code `CSRF_ORIGIN_MISMATCH`.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/auth --filter=@booking-os/web-console
git add packages/auth apps/web-console pnpm-lock.yaml
git commit -m "feat(auth): add opaque BFF session foundation"
```

---

### Task 6: Add transactional outbox and idempotent critical-worker dispatch

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260804_outbox_inbox/migration.sql`
- Create: `apps/api/src/reliability/outbox-event.ts`
- Create: `apps/api/src/reliability/outbox.repository.ts`
- Create: `apps/api/src/reliability/reliability.module.ts`
- Create: `apps/api/src/reliability/outbox.repository.integration.test.ts`
- Create: `apps/worker-critical/src/outbox/outbox-event.ts`
- Create: `apps/worker-critical/src/outbox/outbox-dispatcher.ts`
- Create: `apps/worker-critical/src/outbox/outbox-dispatcher.test.ts`
- Modify: `apps/worker-critical/src/main.ts`
- Modify: `apps/worker-critical/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `OutboxRepository.append(transaction, event)`.
- Produces: `OutboxDispatcher.dispatchBatch(limit): Promise<DispatchSummary>`.
- Uses a unique event ID as the BullMQ job ID and consumer idempotency key.

- [ ] **Step 1: Write failing outbox transaction test**

```ts
test("rolls back aggregate data and outbox together", async () => {
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await transaction.tenantProbe.create({
        data: { tenantId: TENANT_A, value: "rolled-back" },
      });
      await outbox.append(transaction, {
        id: randomUUID(),
        tenantId: TENANT_A,
        type: "FoundationProbeCreated",
        aggregateType: "tenant_probe",
        aggregateId: PROBE_ID,
        payload: { value: "rolled-back" },
      });
      throw new Error("force rollback");
    }),
  );

  assert.equal(await countProbeAndEvent(PROBE_ID), 0);
});
```

- [ ] **Step 2: Write failing duplicate-dispatch test**

```ts
test("dispatches the same event at most once", async () => {
  await dispatcher.dispatchBatch(10);
  await dispatcher.dispatchBatch(10);
  assert.equal(queue.addCallsFor(EVENT_ID), 1);
});
```

- [ ] **Step 3: Verify failure**

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/worker-critical test
```

- [ ] **Step 4: Add outbox/inbox schema**

Required fields:

```text
outbox_events:
  id uuid primary key
  tenant_id uuid nullable only for platform events
  type text
  aggregate_type text
  aggregate_id uuid
  payload jsonb
  occurred_at timestamptz
  available_at timestamptz
  dispatched_at timestamptz nullable
  attempts integer default 0
  last_error text nullable

inbox_messages:
  id uuid primary key
  source text
  external_id text
  payload_hash text
  received_at timestamptz
  processed_at timestamptz nullable
  unique(source, external_id)
```

Apply RLS to tenant-scoped outbox rows. Platform events use a dedicated audited processing path rather than a blank tenant context in normal application requests.

- [ ] **Step 5: Implement safe batch claiming**

Use one transaction with `FOR UPDATE SKIP LOCKED`, increment attempts, and mark successful enqueue with `dispatched_at`. Queue job ID equals outbox event ID. On enqueue uncertainty, leave the event retryable; BullMQ duplicate job ID prevents duplicate work.

- [ ] **Step 6: Add retry/dead-letter behavior**

After the configured maximum attempts, create an operational task or move the event to a dead-letter state with:

```text
event ID, tenant ID, event type, aggregate, attempts, last sanitized error, first/last failure time
```

Never include raw secrets or provider payloads.

- [ ] **Step 7: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/api --filter=@booking-os/worker-critical
pnpm --filter @booking-os/api test:e2e
git add apps/api/prisma apps/api/src/reliability apps/worker-critical pnpm-lock.yaml
git commit -m "feat(reliability): add transactional outbox dispatch"
```

---

### Task 7: Add Playwright smoke and CI foundation gates

**Files:**
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Create: `playwright.config.ts`
- Create: `e2e/foundation.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Create: `scripts/verify-migrations.mjs`
- Create: `scripts/assert-production-config.mjs`
- Create: `docs/runbooks/foundation-recovery.md`
- Modify: `docs/backlog/SPRINT-0.md`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces root scripts: `test:e2e`, `verify:migrations`, `verify:production-config`, `verify:foundation`.
- Produces CI evidence for lint, typecheck, unit, integration, migration, build, secret scan, and smoke E2E.

- [ ] **Step 1: Write the failing Playwright smoke test**

```ts
import { expect, test } from "@playwright/test";

test("console session and tenant-scoped API are reachable", async ({ page, request }) => {
  await page.goto("http://127.0.0.1:3002");
  await expect(page.getByRole("heading", { name: /Booking OS/i })).toBeVisible();

  const health = await request.get("http://127.0.0.1:3001/v1/health");
  expect(health.ok()).toBeTruthy();

  const ready = await request.get("http://127.0.0.1:3001/v1/ready");
  expect(ready.ok()).toBeTruthy();
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm test:e2e
```

Expected: FAIL because Playwright configuration and root script are absent.

- [ ] **Step 3: Add deterministic service startup**

Configure Playwright `webServer` entries for API, console, and storefront. CI starts PostgreSQL and Redis services, applies migrations, seeds two tenants, and waits on `/v1/ready` rather than sleeping for a fixed duration.

- [ ] **Step 4: Add migration and production-config checks**

`verify-migrations.mjs` must:

1. validate Prisma schema;
2. apply migrations to an empty database;
3. apply migrations to the previous-schema fixture when available;
4. fail on drift.

`assert-production-config.mjs` must create a production-like environment and assert that `PAYMENT_PROVIDER=mock` is rejected.

- [ ] **Step 5: Extend CI in ordered jobs**

```text
install
→ lint/typecheck
→ unit tests
→ PostgreSQL/Redis integration and RLS tests
→ migration validation
→ build
→ Playwright smoke
→ secret scan
```

Cache pnpm store and Turborepo outputs, but never cache generated secrets or test databases.

- [ ] **Step 6: Write the foundation recovery runbook**

Document exact commands and decision points for:

- readiness failure;
- Redis outage;
- outbox backlog;
- migration rollback/forward-fix;
- session-store outage;
- restoring the development/test database;
- locating a request by request ID and trace ID.

Do not prescribe direct SQL mutation of domain state.

- [ ] **Step 7: Run full verification**

```bash
pnpm verify:foundation
```

Expected sequence:

```text
lint PASS
typecheck PASS
unit PASS
integration/RLS PASS
migration PASS
build PASS
Playwright PASS
production config guard PASS
```

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml playwright.config.ts e2e .github/workflows/ci.yml scripts docs/runbooks/foundation-recovery.md docs/backlog/SPRINT-0.md pnpm-lock.yaml
git commit -m "ci: enforce Booking OS foundation quality gates"
```

---

## Plan Self-Review

### Spec coverage

- Fail-fast environment configuration: Task 1.
- Liveness/readiness and graceful shutdown: Task 2.
- Request/trace context, structured errors, and log correlation: Task 3.
- PostgreSQL RLS and cross-tenant proof: Task 4.
- Opaque BFF session and CSRF proof: Task 5.
- Transactional inbox/outbox and idempotent dispatch: Task 6.
- Playwright, CI, migration, production guard, and recovery documentation: Task 7.

### Explicitly deferred to the next sub-project plan

- Full user, membership, role, and permission persistence.
- Login, password reset, invitation, and session-reuse detection.
- Production tenant-domain management UI.
- Partner, listing, booking, payment, and finance domain records.

These are not foundation placeholders; they belong to independently reviewable vertical slices defined by the approved Pilot design.

### Completion gate

The foundation plan is complete only when a clean checkout can demonstrate:

```text
BFF request
→ opaque server-side session proof
→ host/session-derived tenant context
→ RLS-protected PostgreSQL transaction
→ transactional outbox record
→ idempotent critical-worker dispatch
→ correlated request/trace logs
```

and all CI gates pass without direct database repair.
