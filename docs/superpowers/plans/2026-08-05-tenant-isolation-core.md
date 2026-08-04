# Tenant Isolation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Sprint 0 RLS proof into a fail-closed tenant execution boundary for HTTP and worker paths.

**Architecture:** One immutable request context carries correlation metadata and trusted tenant identity. `TenantTransactionService` owns the active Prisma transaction, sets `booking_app` plus transaction-local `app.tenant_id`, reuses same-tenant nested calls, and rejects tenant switching. Tenant-owned repositories accept only a scoped transaction client; worker-wide privileged access is isolated in `worker-critical`.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11, Prisma 6.19, PostgreSQL 17, `pg` 8.22, Node test runner, Supertest, pnpm 10, Turborepo.

## Global Constraints

- Execute in a fresh worktree created from `docs/sprint-1a-tenant-isolation-design`; the implementation PR targets `main`.
- Run `pnpm install --frozen-lockfile` and `pnpm --filter @booking-os/api prisma:generate` once before focused tests.
- Follow TDD for every task: failing test, observed failure, minimal implementation, passing focused suite, commit.
- Tenant identity never comes from request body, query string, or an arbitrary browser tenant header.
- Tenant-owned operations use `booking_app` with transaction-local `app.tenant_id`.
- `booking_app` remains non-superuser and `NOBYPASSRLS`.
- Health and readiness remain independent of tenant resolution and database-backed tenant middleware.
- Privileged cross-tenant access stays inside `worker-critical` and is not exported to the API.
- Do not add authentication, memberships, RBAC, onboarding UI, or booking-domain behavior.
- Do not edit generated OpenAPI files; supported public routes remain unchanged.
- Do not log credentials, cookies, authorization values, connection URLs, session tokens, or event payloads.

---

## Task 1: Define Trusted Execution Context and Errors

**Files:**
- Modify: `packages/contracts/src/request-context.ts`
- Create: `packages/contracts/tests/request-context.test.ts`
- Modify: `apps/api/src/common/request-context/request-context.middleware.ts`
- Modify: `apps/api/src/common/request-context/request-context.middleware.test.ts`
- Create: `apps/api/src/tenancy/tenant-context.errors.ts`
- Create: `apps/api/src/tenancy/tenant-execution-context.ts`
- Create: `apps/api/src/tenancy/tenant-execution-context.test.ts`

**Interfaces:**
- Produces `ExecutionSource`, `TenantExecutionContext`, `assertTenantId`, `requireTenantExecutionContext`.
- Produces `TenantContextUnavailableError`, `InvalidTenantContextError`, `TenantContextConflictError`.

- [ ] **Step 1: Write failing shared-contract test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { RequestContext, TenantExecutionContext } from "../src/request-context.js";

test("tenant context requires source and tenant identity", () => {
  const tenant: TenantExecutionContext = {
    requestId: "req-1",
    traceId: "00000000-0000-4000-8000-000000000001",
    source: "internal",
    tenantId: "00000000-0000-4000-8000-000000000001",
  };
  const request: RequestContext = tenant;
  assert.equal(request.source, "internal");
  assert.equal(request.tenantId, tenant.tenantId);
});
```

- [ ] **Step 2: Run and observe the type failure**

```bash
pnpm --filter @booking-os/contracts test
```

Expected: FAIL because `source` and `TenantExecutionContext` do not exist.

- [ ] **Step 3: Implement the contract**

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

- [ ] **Step 4: Add failing tenant-validation tests**

Cover a valid UUID, malformed UUID, and missing tenant ID. Assert the exact error classes rather than database text.

- [ ] **Step 5: Implement errors and narrowing**

```ts
export function requireTenantExecutionContext(context: RequestContext): TenantExecutionContext {
  if (!context.tenantId) throw new TenantContextUnavailableError();
  assertTenantId(context.tenantId);
  return context as TenantExecutionContext;
}
```

`assertTenantId` uses the existing RFC-4122 UUID regex and throws `InvalidTenantContextError`.

- [ ] **Step 6: Set a non-overridable HTTP source**

Change the request-context storage call to:

```ts
this.storage.run({ requestId, traceId, source: "internal" }, next);
```

Add a test proving a request header cannot replace `source`.

- [ ] **Step 7: Run focused suites and commit**

```bash
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/api exec node --test --import tsx src/common/request-context/request-context.middleware.test.ts src/tenancy/tenant-execution-context.test.ts
pnpm --filter @booking-os/api typecheck
git add packages/contracts apps/api/src/common/request-context apps/api/src/tenancy/tenant-context.errors.ts apps/api/src/tenancy/tenant-execution-context*
git commit -m "feat: define trusted tenant execution context"
```

---

## Task 2: Implement the Scoped Tenant Transaction Boundary

**Files:**
- Create: `apps/api/src/tenancy/tenant-transaction.service.ts`
- Create: `apps/api/src/tenancy/tenant-transaction.service.test.ts`
- Modify: `apps/api/src/tenancy/tenancy.module.ts`
- Delete: `apps/api/src/tenancy/tenant-context.ts`
- Delete: `apps/api/src/tenancy/tenant-context.service.ts`
- Modify: `apps/api/src/tenancy/tenant-probe.controller.ts` only enough to use the new service; Task 4 finishes repository extraction.

**Interfaces:**

```ts
export type TenantTransactionClient = Prisma.TransactionClient;

run<T>(
  context: TenantExecutionContext,
  work: (transaction: TenantTransactionClient) => Promise<T>,
): Promise<T>;

runCurrent<T>(
  work: (transaction: TenantTransactionClient) => Promise<T>,
): Promise<T>;
```

- [ ] **Step 1: Write failing service tests**

Cover these exact behaviors:

- invalid tenant rejects before `$transaction` is called;
- `SET LOCAL ROLE booking_app` occurs before `set_config`;
- callback receives the transaction client;
- same-tenant nested call reuses one transaction and the same client;
- different-tenant nested call throws `TenantContextConflictError`;
- callback failure propagates and rolls back;
- `runCurrent` without tenant context throws `TenantContextUnavailableError`.

- [ ] **Step 2: Run and observe missing-service failure**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx src/tenancy/tenant-transaction.service.test.ts
```

- [ ] **Step 3: Implement active transaction storage**

Use a private `AsyncLocalStorage`:

```ts
interface ActiveTenantTransaction {
  readonly context: TenantExecutionContext;
  readonly transaction: Prisma.TransactionClient;
}
```

Core flow:

```ts
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
```

- [ ] **Step 4: Wire the service and remove superseded files**

Export `TenantTransactionService` from `TenancyModule`. Replace current controller/test imports, then delete the old one-field context and mixed service.

- [ ] **Step 5: Run affected suites and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx src/tenancy/tenant-transaction.service.test.ts
pnpm --filter @booking-os/api exec node --test --import tsx test/tenant-isolation.e2e.test.ts
pnpm --filter @booking-os/api typecheck
git add apps/api/src/tenancy apps/api/test/tenant-isolation.e2e.test.ts
git commit -m "feat: enforce scoped tenant transactions"
```

---

## Task 3: Harden Host Resolution and Tenant-Required Routes

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
- Produces `effectiveHostname(headers, trustProxy)` and `tenantSlugFromHostname(hostname)`.
- Produces `TenantRequired()` and `TenantRequiredGuard`.

- [ ] **Step 1: Add failing `TRUST_PROXY` tests**

Assert default `false` and explicit string `"true"` transformed to `true`.

- [ ] **Step 2: Parse and document `TRUST_PROXY`**

Accept only `"true"` or `"false"`, default to `"false"`, transform to `trustProxy: boolean`, and add `TRUST_PROXY=false` to `.env.example`.

- [ ] **Step 3: Add failing host tests**

```ts
assert.equal(effectiveHostname({ host: "tenant-a.localhost:3001" }, false), "tenant-a.localhost");
assert.equal(effectiveHostname({ host: "api.internal", "x-forwarded-host": "tenant-a.example.com" }, false), "api.internal");
assert.equal(effectiveHostname({ host: "api.internal", "x-forwarded-host": "tenant-a.example.com, proxy.internal" }, true), "tenant-a.example.com");
assert.equal(tenantSlugFromHostname("tenant-a.example.com"), "tenant-a");
assert.equal(tenantSlugFromHostname("-invalid.example.com"), undefined);
```

- [ ] **Step 4: Implement host normalization**

Use forwarded host only when `trustProxy` is true; select the first comma-separated value; lowercase, trim, strip a numeric port, reject IPs and malformed labels.

- [ ] **Step 5: Add failing tenant-required guard tests**

Metadata absent returns `true`; metadata present with tenant returns `true`; metadata present without tenant throws `NotFoundException("Tenant context could not be resolved")`.

- [ ] **Step 6: Implement marker and guard**

```ts
export const TENANT_REQUIRED_METADATA = "booking-os:tenant-required";
export const TenantRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_REQUIRED_METADATA, true);
```

The guard uses `Reflector.getAllAndOverride` and `RequestContextStorage.get()` only.

- [ ] **Step 7: Refactor tenant middleware without touching health/readiness**

Inject `EnvironmentService`, `PrismaService`, and `RequestContextStorage`. Resolve the tenant, then nest downstream work with:

```ts
const current = this.requestContext.require();
this.requestContext.run({ ...current, tenantId: tenant.id }, next);
```

If the slug or tenant is absent, call `next()`; the guard returns 404 for marked routes.

In `TenancyModule`, keep database-backed tenant middleware scoped to `TenantProbeController` and future explicitly tenant-aware controllers. Do **not** apply it to `"*"`; otherwise liveness would depend on PostgreSQL.

Register `TenantRequiredGuard` with `APP_GUARD` and mark `TenantProbeController` with `@TenantRequired()`.

- [ ] **Step 8: Run focused suites and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx src/config/environment.schema.test.ts src/tenancy/tenant-host.test.ts src/tenancy/tenant-required.guard.test.ts
pnpm --filter @booking-os/api typecheck
git add apps/api/.env.example apps/api/src/config apps/api/src/tenancy
git commit -m "feat: harden trusted tenant resolution"
```

---

## Task 4: Enforce Tenant-Owned Repository Boundaries

**Files:**
- Create: `apps/api/src/tenancy/tenant-probe.repository.ts`
- Create: `apps/api/src/tenancy/tenant-probe.repository.test.ts`
- Modify: `apps/api/src/tenancy/tenant-probe.controller.ts`
- Modify: `apps/api/src/tenancy/tenancy.module.ts`
- Create: `scripts/tenancy/tenant-repository-manifest.mjs`
- Create: `scripts/tenancy/tenant-repository-boundaries.test.mjs`

**Interfaces:**
- Produces `TenantProbeRepository.list(transaction)`.
- Manifest initially includes `tenant-probe.repository.ts` and `reliability/outbox.repository.ts`.

- [ ] **Step 1: Write failing repository test**

Assert `list(transaction)` calls only:

```ts
transaction.tenantProbe.findMany({
  orderBy: { id: "asc" },
  select: { id: true, tenantId: true, value: true },
});
```

The repository constructor takes no Prisma service.

- [ ] **Step 2: Implement repository and controller orchestration**

Controller flow:

```ts
return this.tenantTransactions.runCurrent((transaction) =>
  this.tenantProbes.list(transaction),
);
```

Register the repository in `TenancyModule`.

- [ ] **Step 3: Add architecture test**

The manifest lists tenant-owned repository files. The test rejects imports/constructors retaining `PrismaService` or `PrismaClient`, while allowing type-only `Prisma.TransactionClient`. Include a temporary invalid fixture in the test to prove detection.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx src/tenancy/tenant-probe.repository.test.ts
node --test scripts/tenancy/tenant-repository-boundaries.test.mjs
pnpm --filter @booking-os/api typecheck
git add apps/api/src/tenancy scripts/tenancy
git commit -m "feat: enforce tenant repository boundaries"
```

---

## Task 5: Complete Isolation, Concurrency, and HTTP Tests

**Files:**
- Modify: `apps/api/test/tenant-isolation.e2e.test.ts`
- Create: `apps/api/test/tenant-context-concurrency.e2e.test.ts`
- Create: `apps/api/test/tenant-resolution.e2e.test.ts`

- [ ] **Step 1: Expand RLS CRUD matrix**

Add tenant A against tenant B cases for list, primary-key lookup, raw select, insert, update, updateMany, delete, deleteMany, upsert, and raw update. Assert null/zero-count/rejection according to Prisma behavior without matching full PostgreSQL error text.

- [ ] **Step 2: Add commit, rollback, and missing-context cases**

A successful callback persists; create-then-throw rolls back; `runCurrent` outside request context rejects; malformed tenant ID opens no transaction.

- [ ] **Step 3: Add parallel leakage test**

Run at least 20 interleaved A/B operations through `RequestContextStorage.run`, cross an async scheduling boundary, and assert every returned row belongs to the current context. Add A → B → no-context sequential coverage to prove `SET LOCAL` does not leak through pooled connections.

- [ ] **Step 4: Add HTTP E2E cases**

Cover tenant A host, tenant B host, unknown host, missing host, malicious body/query/header tenant IDs, `TRUST_PROXY=false`, `TRUST_PROXY=true`, and health/readiness without tenant context.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx test/tenant-isolation.e2e.test.ts test/tenant-context-concurrency.e2e.test.ts test/tenant-resolution.e2e.test.ts
pnpm --filter @booking-os/api typecheck
git add apps/api/test
git commit -m "test: complete tenant isolation coverage"
```

---

## Task 6: Add Fail-Closed Tenant Policy Verification

**Files:**
- Create: `apps/api/src/tenancy/tenant-policy-manifest.ts`
- Create: `apps/api/src/tenancy/tenant-policy-catalog.ts`
- Create: `apps/api/src/tenancy/tenant-policy-verifier.ts`
- Create: `apps/api/src/tenancy/tenant-policy-verifier.test.ts`
- Create: `apps/api/scripts/verify-tenant-policies.ts`
- Modify: `apps/api/package.json`
- Modify: `scripts/verify-migrations.mjs`

**Interfaces:**
- Produces `TENANT_OWNED_TABLES`, `loadTenantPolicyCatalog(pool)`, `verifyTenantPolicies(snapshot, manifest)`.

- [ ] **Step 1: Define manifest**

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

- [ ] **Step 2: Write failing pure verifier tests**

Use one valid snapshot and one fixture each for missing tenant column, unexpected nullability, missing tenant-leading index, RLS disabled, FORCE RLS disabled, missing policy, missing `USING`, missing `WITH CHECK`, expression without `app.tenant_id`, excessive grants, `booking_app` superuser, and `booking_app` BYPASSRLS.

Assert stable messages such as:

```text
tenant_probes: FORCE ROW LEVEL SECURITY is disabled
booking_app: role has BYPASSRLS
```

- [ ] **Step 3: Implement catalog and verifier**

Inspect:

- `information_schema.columns`;
- `pg_class.relrowsecurity` and `relforcerowsecurity`;
- `pg_policy` with `pg_get_expr`;
- `pg_indexes.indexdef`;
- `information_schema.role_table_grants`;
- `pg_roles.rolsuper` and `rolbypassrls`.

Require a policy whose `USING` and `WITH CHECK` both reference `current_setting('app.tenant_id', true)`. Return all failures sorted; a missing declared table is a failure.

- [ ] **Step 4: Add executable command**

The script reads `MIGRATION_DATABASE_URL` or `DATABASE_URL`, opens `pg.Pool`, prints all failures, exits non-zero on any violation, prints `Tenant policy verification PASS.` on success, and closes the pool in `finally`.

Add:

```json
"verify:tenant-policies": "tsx scripts/verify-tenant-policies.ts"
```

- [ ] **Step 5: Wire migration verification**

After deploy/status/diff, run:

```js
run(["--filter", "@booking-os/api", "verify:tenant-policies"], migrationEnvironment);
```

Run it again after upgrading the previous-schema database.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx src/tenancy/tenant-policy-verifier.test.ts
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
git add apps/api/src/tenancy/tenant-policy-* apps/api/scripts/verify-tenant-policies.ts apps/api/package.json scripts/verify-migrations.mjs
git commit -m "feat: verify tenant RLS policy invariants"
```

---

## Task 7: Isolate Privileged Worker Database Access

**Files:**
- Create: `apps/worker-critical/src/database/worker-database.ts`
- Create: `apps/worker-critical/src/database/worker-database.test.ts`
- Modify: `apps/worker-critical/src/outbox/prisma-outbox.repository.ts`
- Modify: `apps/worker-critical/src/queue/providers.ts`
- Modify: `apps/worker-critical/src/outbox/outbox-dispatcher.test.ts`
- Modify: `apps/api/src/reliability/outbox.repository.integration.test.ts`
- Create: `apps/worker-critical/src/outbox/prisma-outbox.repository.integration.test.ts`

**Interface:**

```ts
run<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
```

- [ ] **Step 1: Write failing worker wrapper tests**

Assert one transaction, `SET LOCAL ROLE booking_worker` first, callback receives the transaction, errors propagate, and there is no caller-provided role parameter.

- [ ] **Step 2: Implement worker-only wrapper**

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

Do not export a generic `runAsRole` function.

- [ ] **Step 3: Refactor Outbox repository and providers**

`PrismaOutboxRepository` receives `WorkerDatabase`; each method delegates to `database.run`. Providers keep the raw Prisma token only for connection lifecycle and construct `WorkerDatabase` inside `worker-critical`.

- [ ] **Step 4: Add safety and integration tests**

Assert logs include safe `eventId`, event type, and optional tenant ID but exclude payload and credentials. API-role tests prove tenant B cannot alter tenant A Outbox rows. Worker integration proves `claimBatch`, `markDispatched`, and `markFailed` operate across approved tenant rows.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @booking-os/worker-critical exec node --test --import tsx src/database/worker-database.test.ts src/outbox/outbox-dispatcher.test.ts src/outbox/prisma-outbox.repository.integration.test.ts
pnpm --filter @booking-os/api exec node --test --import tsx src/reliability/outbox.repository.integration.test.ts
pnpm --filter @booking-os/worker-critical typecheck
pnpm --filter @booking-os/api typecheck
git add apps/worker-critical/src apps/api/src/reliability/outbox.repository.integration.test.ts
git commit -m "refactor: isolate privileged worker database access"
```

---

## Task 8: Documentation and Full Acceptance Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/foundation-recovery.md`
- Review: `docs/features/FEATURE-0001-tenant-isolation-core.md`
- Review: `docs/patterns/PATTERN-0001-tenant-scoped-transaction.md`
- Review: `docs/superpowers/specs/2026-08-05-tenant-isolation-core-design.md`

- [ ] **Step 1: Document usage**

Show:

```ts
return tenantTransactions.runCurrent((transaction) =>
  bookingRepository.create(transaction, input),
);
```

Document that repositories receive transaction clients, browser tenant IDs are untrusted, `TRUST_PROXY=false` is the default, and forwarded host is enabled only behind a controlled proxy.

- [ ] **Step 2: Extend recovery runbook**

Add tenant-context and tenant-policy diagnosis using request ID, effective host, read-only PostgreSQL catalog checks, and `pnpm verify:migrations`. Explicitly forbid disabling RLS, granting BYPASSRLS, editing applied migrations, or repairing tenant data with ad-hoc SQL.

- [ ] **Step 3: Run focused and repository-wide gates**

```bash
pnpm format
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:api
pnpm genesis:validate
pnpm api:check-generated
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm build
pnpm test:e2e
pnpm verify:production-config
pnpm audit --audit-level high
pnpm verify:foundation
```

Expected: PASS; committed OpenAPI generated files remain unchanged.

- [ ] **Step 4: Verify acceptance evidence**

Confirm every tenant-owned repository is in the manifest, all CRUD/raw/concurrency tests pass, missing tenant-required routes return safe 404, malicious tenant inputs cannot override host context, migration checks fail closed in fixtures, `booking_app` is `NOBYPASSRLS`, worker privilege is confined to `worker-critical`, and health/readiness remain unchanged.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md docs/runbooks/foundation-recovery.md
git commit -m "docs: document tenant isolation operations"
git status --short
git log --oneline --decorate -8
```

Expected: clean working tree and a focused commit sequence ready for review.
