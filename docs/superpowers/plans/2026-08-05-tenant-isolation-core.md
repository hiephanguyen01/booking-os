# Tenant Isolation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Sprint 0 RLS proof into a fail-closed tenant execution boundary for HTTP and worker paths, enforced by scoped transactions, PostgreSQL FORCE RLS, architecture checks, catalog verification, and cross-tenant tests.

**Architecture:** One immutable request context carries correlation metadata and the trusted tenant identity. A dedicated `TenantTransactionService` owns transaction-local tenant state, sets `booking_app` and `app.tenant_id`, reuses same-tenant nested execution, and rejects tenant switching. Tenant-owned repositories accept only a scoped Prisma transaction client; privileged worker database access is encapsulated separately and validated by catalog and integration tests.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11, Prisma 6.19, PostgreSQL 17, `pg` 8.22, Node test runner, Supertest, pnpm 10, Turborepo.

## Global Constraints

- Work from a fresh isolated worktree created from `docs/sprint-1a-tenant-isolation-design`; target the final implementation PR at `main`.
- Follow TDD: add one focused failing test, observe the intended failure, implement the smallest behavior, then rerun the focused and affected suites.
- Tenant identity must never come from request body, query string, or an arbitrary browser-controlled tenant header.
- Every tenant-owned database operation must run under `booking_app` with transaction-local `app.tenant_id`.
- `booking_app` must remain non-superuser and `NOBYPASSRLS`.
- Global health and readiness routes must continue to work without tenant context.
- Privileged cross-tenant infrastructure access must remain unavailable to ordinary API domain code.
- Do not add authentication, memberships, RBAC, onboarding UI, partner, listing, booking, payment, ledger, settlement, or payout behavior.
- Do not edit generated OpenAPI artifacts directly; this slice must not change the supported public contract.
- Do not log credentials, cookies, authorization values, connection URLs, session tokens, or event payloads.

---

## File Structure

### Shared contracts

- Modify `packages/contracts/src/request-context.ts` — define the execution-source union and the required-tenant subtype used across application boundaries.
- Modify `packages/contracts/src/request-context.test.ts` — compile-time and runtime-shape assertions for the context contract.

### API request and tenancy boundary

- Modify `apps/api/src/common/request-context/request-context.middleware.ts` — create immutable base HTTP context with trusted correlation values and source.
- Modify `apps/api/src/common/request-context/request-context.middleware.test.ts` — verify source and correlation handling.
- Create `apps/api/src/tenancy/tenant-context.errors.ts` — typed missing, invalid, and conflict errors.
- Create `apps/api/src/tenancy/tenant-execution-context.ts` — validation and narrowing from `RequestContext` to `TenantExecutionContext`.
- Create `apps/api/src/tenancy/tenant-execution-context.test.ts` — validation tests.
- Create `apps/api/src/tenancy/tenant-transaction.service.ts` — sole tenant-scoped transaction entry point.
- Create `apps/api/src/tenancy/tenant-transaction.service.test.ts` — unit tests for role/context ordering, rollback, nested reuse, and tenant-switch rejection.
- Delete `apps/api/src/tenancy/tenant-context.ts` — superseded one-field context definition.
- Delete `apps/api/src/tenancy/tenant-context.service.ts` — superseded mixed ALS/transaction service.

### Tenant resolution and route declaration

- Modify `apps/api/src/config/environment.schema.ts` — add `TRUST_PROXY` parsing and transformed `trustProxy` value.
- Modify `apps/api/src/config/environment.schema.test.ts` — verify false default and explicit true parsing.
- Modify `apps/api/.env.example` — add `TRUST_PROXY=false`.
- Create `apps/api/src/tenancy/tenant-host.ts` — normalize direct and proxy-aware effective hostnames and extract valid tenant slugs.
- Create `apps/api/src/tenancy/tenant-host.test.ts` — direct host, port, forwarded host, comma chain, malformed value, and invalid slug cases.
- Modify `apps/api/src/tenancy/tenant-resolution.middleware.ts` — resolve trusted tenant identity and nest downstream execution in the enriched request context.
- Create `apps/api/src/tenancy/tenant-required.decorator.ts` — mark routes that require tenant resolution.
- Create `apps/api/src/tenancy/tenant-required.guard.ts` — return safe 404 when a marked route lacks tenant context.
- Create `apps/api/src/tenancy/tenant-required.guard.test.ts` — marked/global route behavior.
- Modify `apps/api/src/tenancy/tenancy.module.ts` — register middleware for all routes, global metadata guard, repository, and transaction service.

### Tenant repository boundary

- Create `apps/api/src/tenancy/tenant-probe.repository.ts` — tenant-owned probe access accepting only `Prisma.TransactionClient`.
- Create `apps/api/src/tenancy/tenant-probe.repository.test.ts` — focused transaction-client behavior.
- Modify `apps/api/src/tenancy/tenant-probe.controller.ts` — use the required-tenant marker, transaction service, and repository.
- Create `scripts/tenancy/tenant-repository-manifest.mjs` — explicit tenant-owned repository paths.
- Create `scripts/tenancy/tenant-repository-boundaries.test.mjs` — fail when a declared repository imports/injects a root Prisma client.

### Isolation coverage

- Modify `apps/api/test/tenant-isolation.e2e.test.ts` — full RLS CRUD/raw-query matrix through `TenantTransactionService`.
- Create `apps/api/test/tenant-context-concurrency.e2e.test.ts` — parallel ALS and transaction-local leakage tests.
- Create `apps/api/test/tenant-resolution.e2e.test.ts` — host resolution, unknown tenant, missing tenant, malicious tenant input, and global-route coverage.

### Migration policy verification

- Create `apps/api/src/tenancy/tenant-policy-manifest.ts` — declared tenant-owned tables and documented nullable-tenant exceptions.
- Create `apps/api/src/tenancy/tenant-policy-catalog.ts` — PostgreSQL catalog query and normalized snapshot types.
- Create `apps/api/src/tenancy/tenant-policy-verifier.ts` — pure invariant checker.
- Create `apps/api/src/tenancy/tenant-policy-verifier.test.ts` — valid and invalid fixture snapshots.
- Create `apps/api/scripts/verify-tenant-policies.ts` — connect to the migration database, inspect the catalog, and exit non-zero on violations.
- Modify `apps/api/package.json` — add `verify:tenant-policies`.
- Modify `scripts/verify-migrations.mjs` — invoke the policy verifier after migration deployment and drift checks.

### Privileged worker boundary

- Create `apps/worker-critical/src/database/worker-database.ts` — encapsulate `booking_worker` transaction execution.
- Create `apps/worker-critical/src/database/worker-database.test.ts` — verify constant role selection, transaction scope, and callback behavior.
- Modify `apps/worker-critical/src/outbox/prisma-outbox.repository.ts` — use `WorkerDatabase` instead of setting the role in every method.
- Modify `apps/worker-critical/src/queue/providers.ts` — construct and inject `WorkerDatabase` only inside the worker deployment unit.
- Modify `apps/worker-critical/src/outbox/outbox-dispatcher.test.ts` — preserve safe operational metadata and assert payloads are not logged.
- Modify `apps/api/src/reliability/outbox.repository.integration.test.ts` — prove application-role tenant writes remain scoped.
- Create `apps/worker-critical/src/outbox/prisma-outbox.repository.integration.test.ts` — prove the worker role can perform the approved cross-tenant relay operations.

### Documentation and verification

- Modify `README.md` — document tenant-required routes, `TRUST_PROXY`, scoped repository usage, and tenancy verification commands.
- Modify `docs/runbooks/foundation-recovery.md` — add tenant-policy and tenant-context diagnosis without ad-hoc data repair.

---

### Task 1: Define the Trusted Execution Context and Typed Errors

**Files:**
- Modify: `packages/contracts/src/request-context.ts`
- Create: `packages/contracts/src/request-context.test.ts`
- Modify: `apps/api/src/common/request-context/request-context.middleware.ts`
- Modify: `apps/api/src/common/request-context/request-context.middleware.test.ts`
- Create: `apps/api/src/tenancy/tenant-context.errors.ts`
- Create: `apps/api/src/tenancy/tenant-execution-context.ts`
- Create: `apps/api/src/tenancy/tenant-execution-context.test.ts`

**Interfaces:**
- Produces: `ExecutionSource`, `RequestContext`, `TenantExecutionContext`, `assertTenantId(tenantId)`, `requireTenantExecutionContext(context)`.
- Produces errors: `TenantContextUnavailableError`, `InvalidTenantContextError`, `TenantContextConflictError`.
- Consumed by Tasks 2, 3, 5, and 7.

- [ ] **Step 1: Add failing contract and context-validation tests**

Create `packages/contracts/src/request-context.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import type { RequestContext, TenantExecutionContext } from "./request-context.js";

test("tenant execution context requires tenant identity and source", () => {
  const context: TenantExecutionContext = {
    requestId: "req-1",
    traceId: "00000000-0000-4000-8000-000000000001",
    source: "internal",
    tenantId: "00000000-0000-4000-8000-000000000001",
  };
  const request: RequestContext = context;
  assert.equal(request.tenantId, context.tenantId);
  assert.equal(request.source, "internal");
});
```

Create `apps/api/src/tenancy/tenant-execution-context.test.ts` with cases for a valid UUID, malformed UUID, and missing tenant context:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { InvalidTenantContextError, TenantContextUnavailableError } from "./tenant-context.errors.js";
import { assertTenantId, requireTenantExecutionContext } from "./tenant-execution-context.js";

test("rejects a malformed tenant identifier", () => {
  assert.throws(() => assertTenantId("tenant-a"), InvalidTenantContextError);
});

test("requires a tenant identifier in request context", () => {
  assert.throws(
    () => requireTenantExecutionContext({ requestId: "req-1", traceId: crypto.randomUUID(), source: "internal" }),
    TenantContextUnavailableError,
  );
});
```

- [ ] **Step 2: Run the focused tests and observe the expected compile/import failures**

Run:

```bash
pnpm --filter @booking-os/contracts test -- request-context.test.ts
pnpm --filter @booking-os/api test -- tenant-execution-context.test.ts
```

Expected: FAIL because `source`, `TenantExecutionContext`, error classes, and validation functions do not exist.

- [ ] **Step 3: Implement the shared context contract**

Replace `packages/contracts/src/request-context.ts` with:

```ts
export type ExecutionSource = "storefront" | "console" | "worker" | "internal";

export interface RequestContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly source: ExecutionSource;
  readonly actorId?: string;
  readonly tenantId?: string;
}

export interface TenantExecutionContext extends RequestContext {
  readonly tenantId: string;
}
```

- [ ] **Step 4: Implement typed tenancy errors and validation**

Create `apps/api/src/tenancy/tenant-context.errors.ts`:

```ts
export class TenantContextUnavailableError extends Error {
  override readonly name = "TenantContextUnavailableError";
  constructor() {
    super("Tenant context is unavailable.");
  }
}

export class InvalidTenantContextError extends TypeError {
  override readonly name = "InvalidTenantContextError";
  constructor() {
    super("Tenant ID must be a valid UUID.");
  }
}

export class TenantContextConflictError extends Error {
  override readonly name = "TenantContextConflictError";
  constructor(currentTenantId: string, requestedTenantId: string) {
    super(`Cannot switch tenant context from ${currentTenantId} to ${requestedTenantId}.`);
  }
}
```

Create `apps/api/src/tenancy/tenant-execution-context.ts`:

```ts
import type { RequestContext, TenantExecutionContext } from "@booking-os/contracts";
import { InvalidTenantContextError, TenantContextUnavailableError } from "./tenant-context.errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertTenantId(tenantId: string): void {
  if (!UUID_PATTERN.test(tenantId)) throw new InvalidTenantContextError();
}

export function requireTenantExecutionContext(context: RequestContext): TenantExecutionContext {
  if (!context.tenantId) throw new TenantContextUnavailableError();
  assertTenantId(context.tenantId);
  return context as TenantExecutionContext;
}
```

- [ ] **Step 5: Set a trusted HTTP source in request middleware**

Update `RequestContextMiddleware` so the storage call is:

```ts
this.storage.run({ requestId, traceId, source: "internal" }, next);
```

Update its test to assert the stored context contains `source: "internal"` and that no request header can override it.

- [ ] **Step 6: Run focused and affected tests**

Run:

```bash
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/api test -- request-context.middleware.test.ts tenant-execution-context.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the context contract**

```bash
git add packages/contracts/src/request-context.ts packages/contracts/src/request-context.test.ts apps/api/src/common/request-context apps/api/src/tenancy/tenant-context.errors.ts apps/api/src/tenancy/tenant-execution-context.ts apps/api/src/tenancy/tenant-execution-context.test.ts
git commit -m "feat: define trusted tenant execution context"
```

---

### Task 2: Implement the Scoped Tenant Transaction Boundary

**Files:**
- Create: `apps/api/src/tenancy/tenant-transaction.service.ts`
- Create: `apps/api/src/tenancy/tenant-transaction.service.test.ts`
- Modify: `apps/api/src/tenancy/tenancy.module.ts`
- Delete: `apps/api/src/tenancy/tenant-context.ts`
- Delete: `apps/api/src/tenancy/tenant-context.service.ts`
- Modify later consumers only enough to compile; Task 4 completes repository migration.

**Interfaces:**
- Consumes: `TenantExecutionContext`, `RequestContextStorage`, `assertTenantId`, typed tenancy errors.
- Produces:

```ts
export type TenantTransactionClient = Prisma.TransactionClient;

run<T>(context: TenantExecutionContext, work: (transaction: TenantTransactionClient) => Promise<T>): Promise<T>;
runCurrent<T>(work: (transaction: TenantTransactionClient) => Promise<T>): Promise<T>;
```

- [ ] **Step 1: Write failing transaction service tests**

Use a fake Prisma service whose `$transaction` records operations and supplies a fake transaction client. Cover:

```ts
test("sets booking_app before app.tenant_id and executes work", async () => { /* exact call-order assertion */ });
test("rejects invalid tenant ID before opening a transaction", async () => { /* $transaction call count stays zero */ });
test("reuses the active transaction for same-tenant nested execution", async () => { /* one outer transaction */ });
test("rejects nested tenant switching", async () => { /* TenantContextConflictError */ });
test("rolls back when work throws", async () => { /* original error propagates */ });
test("runCurrent requires request tenant context", async () => { /* TenantContextUnavailableError */ });
```

The fake transaction must expose `$executeRawUnsafe`, `$executeRaw`, and a stable identity object so nested reuse can be asserted with `assert.equal(inner, outer)`.

- [ ] **Step 2: Run the focused test and observe missing-service failure**

Run:

```bash
pnpm --filter @booking-os/api test -- tenant-transaction.service.test.ts
```

Expected: FAIL because `TenantTransactionService` is absent.

- [ ] **Step 3: Implement `TenantTransactionService` with private transaction ALS**

Use:

```ts
interface ActiveTenantTransaction {
  readonly context: TenantExecutionContext;
  readonly transaction: Prisma.TransactionClient;
}
```

Required implementation flow:

```ts
async run<T>(context: TenantExecutionContext, work: Work<T>): Promise<T> {
  assertTenantId(context.tenantId);
  const active = this.transactions.getStore();
  if (active) {
    if (active.context.tenantId !== context.tenantId) {
      throw new TenantContextConflictError(active.context.tenantId, context.tenantId);
    }
    return work(active.transaction);
  }

  return this.prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${context.tenantId}, true)`;
    return this.transactions.run(Object.freeze({ context, transaction }), () => work(transaction));
  });
}
```

`runCurrent` must call `requireTenantExecutionContext(this.requestContext.require())` and delegate to `run`.

- [ ] **Step 4: Export the service and remove the superseded context service**

Update `TenancyModule` providers/exports to use `TenantTransactionService`. Delete `tenant-context.ts` and `tenant-context.service.ts`. Update temporary imports in `TenantProbeController` to `TenantTransactionService`; Task 4 will complete its repository refactor.

- [ ] **Step 5: Run focused tests, API typecheck, and current isolation tests**

Run:

```bash
pnpm --filter @booking-os/api test -- tenant-transaction.service.test.ts
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/api test:e2e -- tenant-isolation.e2e.test.ts
```

Expected: PASS after updating the existing isolation test constructor/use sites to the new service API.

- [ ] **Step 6: Commit the transaction boundary**

```bash
git add apps/api/src/tenancy apps/api/test/tenant-isolation.e2e.test.ts
git commit -m "feat: enforce scoped tenant transactions"
```

---

### Task 3: Harden Tenant Host Resolution and Require Tenant Context Explicitly

**Files:**
- Modify: `apps/api/src/config/environment.schema.ts`
- Modify: `apps/api/src/config/environment.schema.test.ts`
- Modify: `apps/api/.env.example`
- Create: `apps/api/src/tenancy/tenant-host.ts`
- Create: `apps/api/src/tenancy/tenant-host.test.ts`
- Modify: `apps/api/src/tenancy/tenant-resolution.middleware.ts`
- Create: `apps/api/src/tenancy/tenant-required.decorator.ts`
- Create: `apps/api/src/tenancy/tenant-required.guard.ts`
- Create: `apps/api/src/tenancy/tenant-required.guard.test.ts`
- Modify: `apps/api/src/tenancy/tenancy.module.ts`

**Interfaces:**
- Produces `effectiveHostname(headers, trustProxy): string | undefined` and `tenantSlugFromHostname(hostname): string | undefined`.
- Produces `TENANT_REQUIRED_METADATA`, `TenantRequired()`, and `TenantRequiredGuard`.
- Consumes `RequestContextStorage` and the global `tenants` table.

- [ ] **Step 1: Add failing environment tests for proxy trust**

Add assertions:

```ts
assert.equal(parseEnvironment(validEnvironment).trustProxy, false);
assert.equal(parseEnvironment({ ...validEnvironment, TRUST_PROXY: "true" }).trustProxy, true);
```

Run:

```bash
pnpm --filter @booking-os/api test -- environment.schema.test.ts
```

Expected: FAIL because `trustProxy` is absent.

- [ ] **Step 2: Parse `TRUST_PROXY` explicitly**

Add a boolean-string schema accepting only `"true"` or `"false"`, default `"false"`, and transform to a boolean. Add `TRUST_PROXY=false` to `apps/api/.env.example`.

Run the environment test and expect PASS.

- [ ] **Step 3: Add failing hostname normalization tests**

Cover these exact expectations:

```ts
assert.equal(effectiveHostname({ host: "tenant-a.localhost:3001" }, false), "tenant-a.localhost");
assert.equal(effectiveHostname({ host: "api.internal", "x-forwarded-host": "tenant-a.example.com" }, false), "api.internal");
assert.equal(effectiveHostname({ host: "api.internal", "x-forwarded-host": "tenant-a.example.com, proxy.internal" }, true), "tenant-a.example.com");
assert.equal(tenantSlugFromHostname("tenant-a.example.com"), "tenant-a");
assert.equal(tenantSlugFromHostname("-invalid.example.com"), undefined);
```

Use a narrow header shape; do not read body, query, or tenant headers.

- [ ] **Step 4: Implement hostname normalization**

Rules:

1. Use `x-forwarded-host` only when `trustProxy === true`.
2. From a forwarded chain use the first comma-separated host.
3. Trim whitespace, lowercase, remove one numeric port, and reject empty/malformed values.
4. Extract only the first DNS label matching `/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/`.
5. Do not accept an IP address as a tenant slug.

Run the hostname test and expect PASS.

- [ ] **Step 5: Add failing tenant-required guard tests**

Use Nest `Reflector` fakes to cover:

- metadata absent: guard returns `true` without tenant context;
- metadata present plus tenant context: returns `true`;
- metadata present without tenant context: throws `NotFoundException` with `Tenant context could not be resolved`.

- [ ] **Step 6: Implement the marker and guard**

Create:

```ts
export const TENANT_REQUIRED_METADATA = "booking-os:tenant-required";
export const TenantRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_REQUIRED_METADATA, true);
```

The guard uses `Reflector.getAllAndOverride` and `RequestContextStorage.get()`; it must not query the database.

- [ ] **Step 7: Refactor tenant resolution middleware**

Inject `EnvironmentService`, `PrismaService`, and `RequestContextStorage`. Resolve the effective hostname with `environment.trustProxy`, load only `{ id: true }` from `tenant`, and when found call:

```ts
const current = this.requestContext.require();
this.requestContext.run({ ...current, tenantId: tenant.id }, next);
```

If no valid slug or no tenant exists, call `next()` without tenant context; the guard decides whether the route is tenant-required. Do not expose existence details on global routes.

- [ ] **Step 8: Register the middleware and global metadata guard**

Apply `TenantResolutionMiddleware` to `"*"`. Register `TenantRequiredGuard` using `APP_GUARD`. Keep RequestContext middleware global and earlier in the nesting chain.

- [ ] **Step 9: Run focused tests and API typecheck**

```bash
pnpm --filter @booking-os/api test -- environment.schema.test.ts tenant-host.test.ts tenant-required.guard.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit host and route hardening**

```bash
git add apps/api/.env.example apps/api/src/config apps/api/src/tenancy
git commit -m "feat: harden trusted tenant resolution"
```

---

### Task 4: Enforce the Tenant Repository Boundary

**Files:**
- Create: `apps/api/src/tenancy/tenant-probe.repository.ts`
- Create: `apps/api/src/tenancy/tenant-probe.repository.test.ts`
- Modify: `apps/api/src/tenancy/tenant-probe.controller.ts`
- Modify: `apps/api/src/tenancy/tenancy.module.ts`
- Create: `scripts/tenancy/tenant-repository-manifest.mjs`
- Create: `scripts/tenancy/tenant-repository-boundaries.test.mjs`

**Interfaces:**
- Consumes `TenantTransactionClient` from Task 2.
- Produces `TenantProbeRepository.list(transaction)` and architecture manifest `tenantOwnedRepositories`.

- [ ] **Step 1: Add a failing repository unit test**

Test that `list(transaction)` calls only `transaction.tenantProbe.findMany` with:

```ts
{ orderBy: { id: "asc" }, select: { id: true, tenantId: true, value: true } }
```

The test repository constructor must take no Prisma service.

- [ ] **Step 2: Implement the focused repository**

Create:

```ts
@Injectable()
export class TenantProbeRepository {
  list(transaction: TenantTransactionClient): Promise<readonly TenantProbeResponse[]> {
    return transaction.tenantProbe.findMany({
      orderBy: { id: "asc" },
      select: { id: true, tenantId: true, value: true },
    });
  }
}
```

Move/export the response type from the controller or place it beside the repository so the controller remains orchestration-only.

- [ ] **Step 3: Refactor the controller**

Add `@TenantRequired()` to the controller. Keep the test-only authorization behavior, then call:

```ts
return this.tenantTransactions.runCurrent((transaction) =>
  this.tenantProbes.list(transaction),
);
```

Register the repository in `TenancyModule`.

- [ ] **Step 4: Add a failing architecture test**

Create a manifest containing:

```js
export const tenantOwnedRepositories = [
  "apps/api/src/tenancy/tenant-probe.repository.ts",
  "apps/api/src/reliability/outbox.repository.ts",
];
```

The Node test reads each file and fails on these patterns:

- import of `PrismaService`;
- import of `PrismaClient`;
- constructor parameter typed as either root client;
- field assignment retaining a root client.

It must allow type-only `Prisma.TransactionClient` imports.

- [ ] **Step 5: Run architecture tests and verify the intended failure fixture**

The test must create a temporary repository source containing `constructor(private readonly prisma: PrismaService)` and assert the checker reports that path. Then run it against the real manifest and expect no failures.

Run:

```bash
pnpm test:scripts -- tenant-repository-boundaries.test.mjs
pnpm --filter @booking-os/api test -- tenant-probe.repository.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit repository enforcement**

```bash
git add apps/api/src/tenancy scripts/tenancy
git commit -m "feat: enforce tenant repository boundaries"
```

---

### Task 5: Complete Cross-Tenant CRUD, Context, and HTTP Coverage

**Files:**
- Modify: `apps/api/test/tenant-isolation.e2e.test.ts`
- Create: `apps/api/test/tenant-context-concurrency.e2e.test.ts`
- Create: `apps/api/test/tenant-resolution.e2e.test.ts`

**Interfaces:**
- Consumes `TenantTransactionService`, `RequestContextStorage`, `TenantRequired`, and trusted host resolution.
- Produces the regression matrix that later tenant-owned models must follow.

- [ ] **Step 1: Expand the RLS fixture helpers**

Create helpers that seed one probe for tenant A and one for tenant B through `TenantTransactionService.run`. Keep cleanup tenant-scoped. Never use root Prisma to mutate `tenant_probes`.

- [ ] **Step 2: Add failing cross-tenant mutation tests**

Add explicit tests for:

```text
A cannot update B by primary key
A updateMany does not alter B
A cannot delete B by primary key
A deleteMany does not delete B
A cannot upsert B's primary key with tenant B ownership
A raw SELECT by B primary key returns zero rows
A raw UPDATE against B affects zero rows
A cannot create a row with tenant_id B
```

For operations that RLS hides, assert `null`, zero count, or `P2025` according to Prisma behavior. For prohibited `WITH CHECK` writes, assert rejection without depending on the complete database error text.

- [ ] **Step 3: Run the isolation file and verify at least the new update/delete tests fail before implementation adjustments**

```bash
pnpm --filter @booking-os/api test:e2e -- tenant-isolation.e2e.test.ts
```

Expected: new cases expose missing helper/service integration or missing test setup, then become green after using the scoped transaction boundary consistently.

- [ ] **Step 4: Add transaction commit, rollback, and missing-context tests**

Assert:

- a successful callback commits its probe;
- a callback that creates then throws leaves no probe;
- `runCurrent` outside `RequestContextStorage.run` rejects with `TenantContextUnavailableError`;
- invalid tenant IDs reject before `$transaction` is called.

- [ ] **Step 5: Add parallel context-leakage tests**

In `tenant-context-concurrency.e2e.test.ts`, start at least 20 interleaved operations:

```ts
await Promise.all(
  Array.from({ length: 20 }, (_, index) => {
    const context = index % 2 === 0 ? contextA : contextB;
    return requestContext.run(context, async () => {
      await setImmediatePromise();
      const rows = await tenantTransactions.runCurrent((tx) => tx.tenantProbe.findMany());
      assert.ok(rows.every((row) => row.tenantId === context.tenantId));
    });
  }),
);
```

Add a sequential A → B → no-context sequence to prove pooled connections do not retain transaction-local `app.tenant_id`.

- [ ] **Step 6: Add HTTP tenant-resolution tests**

Boot the Nest app and cover:

- `Host: tenant-a.localhost` returns only tenant A probe data;
- `Host: tenant-b.localhost` returns only tenant B data;
- unknown tenant host returns 404 on the tenant-required probe route;
- absent/invalid host returns 404 on that route;
- body/query/header values containing tenant B cannot override tenant A host context;
- `/api/health` and `/api/ready` remain callable without tenant host context;
- forwarded host is ignored when `TRUST_PROXY=false` and honored in a separate app instance with `TRUST_PROXY=true`.

- [ ] **Step 7: Run all API tenancy suites**

```bash
pnpm --filter @booking-os/api test -- tenant-transaction.service.test.ts tenant-host.test.ts tenant-required.guard.test.ts tenant-probe.repository.test.ts
pnpm --filter @booking-os/api test:e2e -- tenant-isolation.e2e.test.ts tenant-context-concurrency.e2e.test.ts tenant-resolution.e2e.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the isolation matrix**

```bash
git add apps/api/test apps/api/src/tenancy
git commit -m "test: complete tenant isolation coverage"
```

---

### Task 6: Add Fail-Closed Tenant Policy Verification

**Files:**
- Create: `apps/api/src/tenancy/tenant-policy-manifest.ts`
- Create: `apps/api/src/tenancy/tenant-policy-catalog.ts`
- Create: `apps/api/src/tenancy/tenant-policy-verifier.ts`
- Create: `apps/api/src/tenancy/tenant-policy-verifier.test.ts`
- Create: `apps/api/scripts/verify-tenant-policies.ts`
- Modify: `apps/api/package.json`
- Modify: `scripts/verify-migrations.mjs`

**Interfaces:**
- Produces `TENANT_OWNED_TABLES`, `loadTenantPolicyCatalog(pool)`, and `verifyTenantPolicies(snapshot, manifest): readonly string[]`.
- Consumed by migration verification and CI through existing `pnpm verify:migrations`.

- [ ] **Step 1: Define the manifest and normalized catalog types**

The manifest must contain:

```ts
export const TENANT_OWNED_TABLES = [
  { table: "tenant_probes", tenantColumnNullable: false },
  {
    table: "outbox_events",
    tenantColumnNullable: true,
    nullableReason: "Global infrastructure events may not belong to a tenant.",
  },
] as const;
```

Catalog snapshot fields per table:

```ts
interface TenantTablePolicySnapshot {
  table: string;
  tenantColumnExists: boolean;
  tenantColumnNullable: boolean;
  hasTenantLeadingIndex: boolean;
  rowSecurityEnabled: boolean;
  rowSecurityForced: boolean;
  policies: readonly { name: string; usingExpression: string | null; checkExpression: string | null }[];
  bookingAppPrivileges: readonly string[];
}

interface BookingAppRoleSnapshot {
  superuser: boolean;
  bypassRls: boolean;
}
```

- [ ] **Step 2: Add failing pure verifier tests**

Create one valid snapshot and individual invalid snapshots for:

- missing tenant column;
- unexpected nullable tenant column;
- missing tenant-leading index;
- RLS disabled;
- FORCE RLS disabled;
- no policy;
- missing `USING` expression;
- missing `WITH CHECK` expression;
- expression not referencing `app.tenant_id`;
- `booking_app` superuser;
- `booking_app` BYPASSRLS;
- privilege outside `SELECT`, `INSERT`, `UPDATE`, `DELETE`.

Assert exact stable messages such as:

```text
tenant_probes: FORCE ROW LEVEL SECURITY is disabled
booking_app: role has BYPASSRLS
outbox_events: policy outbox_event_tenant_isolation is missing WITH CHECK app.tenant_id binding
```

- [ ] **Step 3: Run the focused verifier test and observe missing implementation failure**

```bash
pnpm --filter @booking-os/api test -- tenant-policy-verifier.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement the pure verifier**

Normalize expressions by collapsing whitespace and lowercasing before checking both `current_setting('app.tenant_id', true)` and `set_config`-compatible transaction-local semantics. Require at least one policy whose `USING` and `WITH CHECK` both bind to `app.tenant_id`. Return all failures sorted by table and message; never stop at the first violation.

- [ ] **Step 5: Implement PostgreSQL catalog inspection**

Use parameterized queries and these catalogs:

- `information_schema.columns` for tenant column existence/nullability;
- `pg_class.relrowsecurity` and `pg_class.relforcerowsecurity`;
- `pg_policy`, `pg_get_expr(polqual, polrelid)`, and `pg_get_expr(polwithcheck, polrelid)`;
- `pg_indexes.indexdef` for an index whose first indexed column is `tenant_id`;
- `information_schema.role_table_grants` for `booking_app` privileges;
- `pg_roles.rolsuper` and `pg_roles.rolbypassrls` for role safety.

Only inspect tables declared in the manifest. A missing declared table is a failure.

- [ ] **Step 6: Add the executable verifier**

`apps/api/scripts/verify-tenant-policies.ts` must:

1. read `MIGRATION_DATABASE_URL` or `DATABASE_URL`;
2. create a `pg.Pool` with that URL;
3. load the catalog snapshot;
4. print every failure to stderr with a `Tenant policy verification FAIL:` prefix;
5. set exit code 1 when failures exist;
6. print `Tenant policy verification PASS.` on success;
7. close the pool in `finally`.

Add to `apps/api/package.json`:

```json
"verify:tenant-policies": "tsx scripts/verify-tenant-policies.ts"
```

- [ ] **Step 7: Wire it into migration verification**

After deploy/status/diff in `scripts/verify-migrations.mjs`, call:

```js
run(["--filter", "@booking-os/api", "verify:tenant-policies"], migrationEnvironment);
```

Call it for the previous-schema upgraded database as well, after migrations complete.

- [ ] **Step 8: Run pure and real-database verification**

```bash
pnpm --filter @booking-os/api test -- tenant-policy-verifier.test.ts
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
```

Expected: PASS against the current migrated schema. Temporarily change a local test fixture snapshot, not a committed migration, to confirm each invalid case fails closed.

- [ ] **Step 9: Commit policy verification**

```bash
git add apps/api/src/tenancy/tenant-policy-* apps/api/scripts/verify-tenant-policies.ts apps/api/package.json scripts/verify-migrations.mjs
git commit -m "feat: verify tenant RLS policy invariants"
```

---

### Task 7: Encapsulate and Test the Privileged Worker Database Path

**Files:**
- Create: `apps/worker-critical/src/database/worker-database.ts`
- Create: `apps/worker-critical/src/database/worker-database.test.ts`
- Modify: `apps/worker-critical/src/outbox/prisma-outbox.repository.ts`
- Modify: `apps/worker-critical/src/queue/providers.ts`
- Modify: `apps/worker-critical/src/outbox/outbox-dispatcher.test.ts`
- Modify: `apps/api/src/reliability/outbox.repository.integration.test.ts`
- Create: `apps/worker-critical/src/outbox/prisma-outbox.repository.integration.test.ts`

**Interfaces:**
- Produces `WorkerDatabase.run<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>`.
- `PrismaOutboxRepository` consumes `WorkerDatabase`, not `PrismaClient`.
- No API module imports or exports the worker wrapper.

- [ ] **Step 1: Add failing worker database unit tests**

Use a fake Prisma client and assert:

- one transaction is opened per top-level `run` call;
- `SET LOCAL ROLE booking_worker` is the first database action;
- the callback receives the transaction client;
- callback errors propagate and cause transaction rejection;
- no method accepts a caller-provided role name.

- [ ] **Step 2: Implement the worker-only wrapper**

Create:

```ts
const WORKER_DATABASE_ROLE = "booking_worker";

export class WorkerDatabase {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${WORKER_DATABASE_ROLE}`);
      return work(transaction);
    });
  }
}
```

The role constant is private to the worker deployment unit. Do not export a generic `runAsRole` API.

- [ ] **Step 3: Refactor `PrismaOutboxRepository`**

Replace the Prisma client constructor with `WorkerDatabase`. Each method delegates its transaction body to `this.database.run`. Remove the repeated role constant and `SET LOCAL ROLE` calls from the repository.

- [ ] **Step 4: Update worker providers**

Keep `PRISMA_CLIENT_TOKEN` for lifecycle shutdown. Construct one `WorkerDatabase` in the Outbox polling provider and pass it to `PrismaOutboxRepository`. Do not register `WorkerDatabase` in the API application or a shared package.

- [ ] **Step 5: Add safe logging assertions**

Extend dispatcher/polling tests to capture structured log fields and assert allowed metadata includes `eventId`, `eventType`, and non-null `tenantId`, while serialized `payload`, database URL, Redis password, and authorization fields are absent.

- [ ] **Step 6: Add role-boundary integration tests**

API integration test:

- append tenant A event under tenant A transaction;
- verify tenant B application transaction cannot read/update that event;
- verify a global event cannot be inserted through a tenant transaction when its tenant binding violates the policy.

Worker integration test:

- seed tenant A and tenant B events;
- `claimBatch(10)` returns both through `booking_worker`;
- `markDispatched` and `markFailed` update approved rows;
- the repository never exposes a generic raw query method.

- [ ] **Step 7: Run worker and API reliability suites**

```bash
pnpm --filter @booking-os/worker-critical test -- worker-database.test.ts outbox-dispatcher.test.ts prisma-outbox.repository.integration.test.ts
pnpm --filter @booking-os/api test -- outbox.repository.integration.test.ts
pnpm --filter @booking-os/worker-critical typecheck
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit privileged-path separation**

```bash
git add apps/worker-critical/src/database apps/worker-critical/src/outbox apps/worker-critical/src/queue/providers.ts apps/api/src/reliability/outbox.repository.integration.test.ts
git commit -m "refactor: isolate privileged worker database access"
```

---

### Task 8: Document Operations and Run the Full Acceptance Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/foundation-recovery.md`
- Review: `docs/features/FEATURE-0001-tenant-isolation-core.md`
- Review: `docs/patterns/PATTERN-0001-tenant-scoped-transaction.md`
- Review: `docs/superpowers/specs/2026-08-05-tenant-isolation-core-design.md`

**Interfaces:**
- Consumes every prior task.
- Produces the final operational usage and verified implementation branch.

- [ ] **Step 1: Document developer usage**

Add a README section showing:

```ts
return tenantTransactions.runCurrent((transaction) =>
  bookingRepository.create(transaction, input),
);
```

State that tenant-owned repositories accept a transaction client, tenant IDs from request body/query/header are not authorization inputs, `TRUST_PROXY=false` is the local default, and forwarded host is trusted only when deployment proxy configuration is controlled.

Document commands:

```bash
pnpm --filter @booking-os/api test:e2e -- tenant-isolation.e2e.test.ts tenant-context-concurrency.e2e.test.ts tenant-resolution.e2e.test.ts
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm test:scripts
```

- [ ] **Step 2: Extend the recovery runbook**

Add a tenant-isolation diagnosis section:

1. capture request ID, effective hostname, and safe tenant ID;
2. verify `/health` and `/ready` first;
3. run `pnpm verify:migrations` against a dedicated non-production database;
4. inspect `pg_class`, `pg_policy`, and `pg_roles` read-only output;
5. never disable RLS, grant BYPASSRLS, edit an applied migration, or repair tenant rows with ad-hoc SQL;
6. use a reviewed forward migration for policy/schema correction.

- [ ] **Step 3: Run formatting and focused tenancy verification**

```bash
pnpm format
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test:scripts
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
pnpm --filter @booking-os/worker-critical test
```

Expected: PASS with no uncommitted generated artifacts.

- [ ] **Step 4: Run migration, OpenAPI, Genesis, build, security, and browser gates**

With PostgreSQL and Redis available:

```bash
pnpm genesis:validate
pnpm api:check-generated
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm build
pnpm test:e2e
pnpm verify:production-config
pnpm audit --audit-level high
```

Expected: PASS. The committed OpenAPI contract remains unchanged because tenant probe routes are internal.

- [ ] **Step 5: Run the repository-wide Foundation gate**

```bash
pnpm verify:foundation
```

Expected: PASS across formatting, lint, typecheck, migration deployment, unit tests, API/RLS tests, migration verification, build, Playwright smoke, and production configuration guard.

- [ ] **Step 6: Review implementation against the approved acceptance gate**

Confirm with command output and code inspection:

- every tenant-owned repository in the manifest uses a scoped transaction client;
- cross-tenant CRUD/raw-query and context-leakage tests pass;
- unknown/missing tenant-required routes return safe 404;
- client-supplied tenant IDs cannot override trusted context;
- migration policy checks fail closed in unit fixtures and pass on the real migrated schema;
- `booking_app` remains non-superuser and `NOBYPASSRLS`;
- worker privilege is isolated to `worker-critical`;
- health/readiness behavior and OpenAPI generated files are unchanged.

- [ ] **Step 7: Commit documentation and verification evidence**

```bash
git add README.md docs/runbooks/foundation-recovery.md
git commit -m "docs: document tenant isolation operations"

git status --short
git log --oneline --decorate -8
```

Expected: clean working tree and a reviewable sequence of focused commits.
