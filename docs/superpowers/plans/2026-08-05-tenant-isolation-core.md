# Tenant Isolation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Sprint 0 RLS proof into a fail-closed tenant boundary and establish enforceable Hexagonal Architecture rules for new and touched `apps/api` modules.

**Architecture:** The tenancy module is reorganized into domain, application, and infrastructure zones. HTTP adapters call application use cases, application code depends on technology-neutral ports, and Prisma adapters implement those ports. `PrismaTenantTransactionAdapter` owns PostgreSQL role/context setup and supplies a focused `TenantDataSession` instead of exposing `Prisma.TransactionClient`.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11, Prisma 6.19, PostgreSQL 17, `pg` 8.22, Node test runner, Supertest, pnpm 10, Turborepo.

## Global Constraints

- Execute in a fresh worktree created from `docs/sprint-1a-tenant-isolation-design`; the implementation PR targets `main`.
- Run `pnpm install --frozen-lockfile` and `pnpm --filter @booking-os/api prisma:generate` once before focused tests.
- Follow TDD for every task: write one focused failing test, observe the intended failure, implement the smallest behavior, rerun focused and affected suites, then commit.
- `domain/` imports no NestJS, Prisma, HTTP framework, queue, logger, environment, or infrastructure code.
- `application/` imports only same-module domain/application files and technology-neutral shared contracts.
- Application ports expose no Prisma, NestJS, Express, Fastify, BullMQ, Redis, or PostgreSQL-specific types.
- Inbound adapters invoke use cases; they do not query Prisma directly.
- One module does not import another module's `infrastructure/` directory.
- Tenant identity never comes from request body, query string, or an arbitrary browser tenant header.
- Tenant-owned operations use `booking_app` with transaction-local `app.tenant_id`.
- `booking_app` remains non-superuser and `NOBYPASSRLS`.
- Health and readiness remain independent of tenant resolution and database-backed tenant middleware.
- Privileged cross-tenant access stays inside `worker-critical` and is not exported to the API.
- Do not add authentication, memberships, RBAC, onboarding UI, or booking-domain behavior.
- Do not edit generated OpenAPI files; supported public routes remain unchanged.
- Do not log credentials, cookies, authorization values, connection URLs, session tokens, or event payloads.

---

## Target File Structure

```text
apps/api/src/modules/tenancy/
├── domain/
│   ├── resolved-tenant.ts
│   ├── tenant-id.ts
│   ├── tenant-id.test.ts
│   ├── tenant-slug.ts
│   └── tenant-slug.test.ts
├── application/
│   ├── ports/
│   │   ├── tenant-directory.port.ts
│   │   ├── tenant-probe-repository.port.ts
│   │   ├── tenant-transaction.port.ts
│   │   └── tenant-transaction.port.test.ts
│   ├── use-cases/
│   │   ├── list-tenant-probes.use-case.ts
│   │   ├── list-tenant-probes.use-case.test.ts
│   │   ├── resolve-tenant.use-case.ts
│   │   └── resolve-tenant.use-case.test.ts
│   ├── tenant-context.errors.ts
│   ├── tenant-execution-context.ts
│   └── tenant-execution-context.test.ts
├── infrastructure/
│   ├── http/
│   │   ├── effective-hostname.ts
│   │   ├── effective-hostname.test.ts
│   │   ├── tenant-probe.controller.ts
│   │   ├── tenant-required.decorator.ts
│   │   ├── tenant-required.guard.ts
│   │   ├── tenant-required.guard.test.ts
│   │   ├── tenant-resolution.middleware.ts
│   │   └── tenant-resolution.middleware.test.ts
│   └── persistence/
│       ├── tenant-policy-manifest.ts
│       ├── tenant-policy-verifier.ts
│       ├── tenant-policy-verifier.test.ts
│       └── prisma/
│           ├── prisma-tenant-directory.adapter.ts
│           ├── prisma-tenant-directory.adapter.test.ts
│           ├── prisma-tenant-probe-repository.adapter.ts
│           ├── prisma-tenant-probe-repository.adapter.test.ts
│           ├── prisma-tenant-transaction.adapter.ts
│           └── prisma-tenant-transaction.adapter.test.ts
├── tenancy.tokens.ts
└── tenancy.module.ts
```

Delete existing `apps/api/src/tenancy/` files only after replacements compile and focused tests pass.

---

### Task 1: Add the Hexagonal Architecture Verification Gate

**Files:**
- Create: `scripts/architecture/api-module-boundaries.mjs`
- Create: `scripts/architecture/api-module-boundaries.test.mjs`
- Create: `scripts/architecture/api-module-manifest.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces `verifyApiModuleBoundaries({ repositoryRoot, modules })`.
- Produces root command `pnpm verify:architecture`.
- The initial manifest exports an empty `modules` array; Task 2 registers tenancy after its module root exists.

- [ ] **Step 1: Write failing architecture-fixture tests**

Create temporary module trees inside the test. Include one valid graph:

```js
const valid = {
  "domain/entity.ts": "export interface Entity { readonly id: string }",
  "application/ports/repository.port.ts":
    'import type { Entity } from "../../domain/entity.js"; export interface RepositoryPort { find(): Promise<Entity | null> }',
  "infrastructure/persistence/prisma.adapter.ts":
    'import type { RepositoryPort } from "../../application/ports/repository.port.js"; export class Adapter implements RepositoryPort { async find() { return null; } }',
};
```

Invalid fixtures must be detected for domain-to-NestJS, domain-to-Prisma, application-to-Prisma, application-to-infrastructure, a port containing `Prisma.TransactionClient`, and cross-module infrastructure import.

- [ ] **Step 2: Run and observe missing-verifier failure**

```bash
node --test scripts/architecture/api-module-boundaries.test.mjs
```

Expected: FAIL because the verifier and manifest do not exist.

- [ ] **Step 3: Implement deterministic import scanning**

Use Node `fs`, `path`, and regular expressions over static `import` and `export ... from` declarations. Classify each `.ts` file as domain, application, infrastructure, or composition root. Return sorted failures in `<relative-file>: <message>` format.

Use these forbidden package prefixes:

```js
const DOMAIN_FORBIDDEN = [
  "@nestjs/",
  "@prisma/client",
  "express",
  "fastify",
  "bullmq",
  "ioredis",
  "pg",
];
const APPLICATION_FORBIDDEN = DOMAIN_FORBIDDEN;
const PORT_FORBIDDEN_TYPES = [
  "Prisma.",
  "TransactionClient",
  "PrismaClient",
  "Request<",
  "Response<",
  "Job<",
];
```

Composition roots may import every zone inside their own module.

- [ ] **Step 4: Add command and CI step**

Add to root `package.json`:

```json
"verify:architecture": "node scripts/architecture/api-module-boundaries.mjs"
```

The executable prints all failures, exits `1` on violations, and prints `API module boundary verification PASS.` on success.

Add this permanent CI step after Genesis validation:

```yaml
- name: API architecture boundaries
  run: pnpm verify:architecture
```

- [ ] **Step 5: Run and commit**

```bash
node --test scripts/architecture/api-module-boundaries.test.mjs
pnpm verify:architecture
pnpm format
git add scripts/architecture package.json .github/workflows/ci.yml
git commit -m "feat: enforce hexagonal API module boundaries"
```

---

### Task 2: Define Trusted Context and Domain Types

**Files:**
- Modify: `packages/contracts/src/request-context.ts`
- Create: `packages/contracts/tests/request-context.test.ts`
- Modify: `apps/api/src/common/request-context/request-context.middleware.ts`
- Modify: `apps/api/src/common/request-context/request-context.middleware.test.ts`
- Create: `apps/api/src/modules/tenancy/domain/tenant-id.ts`
- Create: `apps/api/src/modules/tenancy/domain/tenant-id.test.ts`
- Create: `apps/api/src/modules/tenancy/domain/resolved-tenant.ts`
- Create: `apps/api/src/modules/tenancy/application/tenant-context.errors.ts`
- Create: `apps/api/src/modules/tenancy/application/tenant-execution-context.ts`
- Create: `apps/api/src/modules/tenancy/application/tenant-execution-context.test.ts`
- Modify: `scripts/architecture/api-module-manifest.mjs`

**Interfaces:**

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

Produces `assertTenantId`, `requireTenantExecutionContext`, `TenantContextUnavailableError`, `InvalidTenantContextError`, and `TenantContextConflictError`.

- [ ] **Step 1: Write failing shared-contract test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { RequestContext, TenantExecutionContext } from "../src/request-context.js";

test("tenant execution context is assignable to request context", () => {
  const tenant: TenantExecutionContext = {
    requestId: "req-1",
    traceId: "00000000-0000-4000-8000-000000000001",
    source: "internal",
    tenantId: "00000000-0000-4000-8000-000000000001",
  };
  const request: RequestContext = tenant;
  assert.equal(request.tenantId, tenant.tenantId);
});
```

- [ ] **Step 2: Run and observe the contract failure**

```bash
pnpm --filter @booking-os/contracts test
```

Expected: FAIL because `source` and `TenantExecutionContext` do not exist.

- [ ] **Step 3: Implement contract and fixed HTTP source**

Update request middleware storage to:

```ts
this.storage.run({ requestId, traceId, source: "internal" }, next);
```

Add a test proving `x-source`, `x-tenant-id`, and `x-actor-id` headers cannot populate trusted fields.

- [ ] **Step 4: Write failing domain/application tests**

Cover a valid RFC-4122 UUID, malformed UUID, missing tenant ID, valid narrowing without mutation, and stable error class names.

- [ ] **Step 5: Implement validation without framework imports**

`tenant-id.ts` contains only the UUID regex and validation function. Error classes extend `Error`. `tenant-execution-context.ts` imports only contracts, domain validation, and application errors.

- [ ] **Step 6: Register tenancy in architecture manifest**

Set:

```js
export const modules = [
  { name: "tenancy", root: "apps/api/src/modules/tenancy" },
];
```

- [ ] **Step 7: Run and commit**

```bash
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/common/request-context/request-context.middleware.test.ts \
  src/modules/tenancy/domain/tenant-id.test.ts \
  src/modules/tenancy/application/tenant-execution-context.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add packages/contracts apps/api/src/common/request-context apps/api/src/modules/tenancy scripts/architecture/api-module-manifest.mjs
git commit -m "feat: define trusted tenant context contracts"
```

---

### Task 3: Implement Tenant Slug, Directory Port, and Resolution Use Case

**Files:**
- Create: `apps/api/src/modules/tenancy/domain/tenant-slug.ts`
- Create: `apps/api/src/modules/tenancy/domain/tenant-slug.test.ts`
- Create: `apps/api/src/modules/tenancy/application/ports/tenant-directory.port.ts`
- Create: `apps/api/src/modules/tenancy/application/use-cases/resolve-tenant.use-case.ts`
- Create: `apps/api/src/modules/tenancy/application/use-cases/resolve-tenant.use-case.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-directory.adapter.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-directory.adapter.test.ts`

**Interfaces:**

```ts
export function tenantSlugFromHostname(hostname: string): string | undefined;
export interface TenantDirectoryPort {
  findActiveBySlug(slug: string): Promise<ResolvedTenant | null>;
}
export class ResolveTenantUseCase {
  constructor(private readonly tenants: TenantDirectoryPort) {}
  execute(hostname: string): Promise<ResolvedTenant | null>;
}
```

- [ ] **Step 1: Write failing slug tests**

```ts
assert.equal(tenantSlugFromHostname("tenant-a.example.com"), "tenant-a");
assert.equal(tenantSlugFromHostname("TENANT-A.EXAMPLE.COM"), "tenant-a");
assert.equal(tenantSlugFromHostname("-invalid.example.com"), undefined);
assert.equal(tenantSlugFromHostname("127.0.0.1"), undefined);
assert.equal(tenantSlugFromHostname("localhost"), undefined);
```

- [ ] **Step 2: Implement pure slug parsing**

Lowercase and trim input, reject IPs and malformed labels, and accept only:

```ts
/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
```

The file imports no infrastructure.

- [ ] **Step 3: Write failing use-case tests with a fake port**

Assert valid host calls `findActiveBySlug("tenant-a")` once, invalid host returns `null` without calling the port, and the use case returns the port result unchanged.

- [ ] **Step 4: Implement port and use case**

The use case imports only domain slug parsing, the port, and domain result type.

- [ ] **Step 5: Write failing Prisma adapter test**

Assert the adapter calls:

```ts
prisma.tenant.findUnique({
  where: { slug: "tenant-a" },
  select: { id: true, slug: true },
});
```

- [ ] **Step 6: Implement adapter and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/domain/tenant-slug.test.ts \
  src/modules/tenancy/application/use-cases/resolve-tenant.use-case.test.ts \
  src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-directory.adapter.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add apps/api/src/modules/tenancy
git commit -m "feat: resolve tenants through an application port"
```

---

### Task 4: Build HTTP Inbound Adapters

**Files:**
- Modify: `apps/api/src/config/environment.schema.ts`
- Modify: `apps/api/src/config/environment.schema.test.ts`
- Modify: `apps/api/.env.example`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/effective-hostname.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/effective-hostname.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-resolution.middleware.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-resolution.middleware.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-required.decorator.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-required.guard.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-required.guard.test.ts`
- Create: `apps/api/src/modules/tenancy/tenancy.tokens.ts`
- Create: `apps/api/src/modules/tenancy/tenancy.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `effectiveHostname(headers, trustProxy)`.
- Produces `TENANT_DIRECTORY_PORT`, `TENANT_TRANSACTION_PORT`, `TenantRequired()`, and `TenantRequiredGuard`.
- Middleware depends on `ResolveTenantUseCase`, `EnvironmentService`, and `RequestContextStorage`; it has no Prisma dependency.

- [ ] **Step 1: Add failing `TRUST_PROXY` tests**

Assert default `false`, explicit `"true"` becomes `true`, explicit `"false"` remains `false`, and any other string fails parsing.

- [ ] **Step 2: Parse and document `TRUST_PROXY`**

Add a strict enum defaulting to `"false"`, transform to `trustProxy: boolean`, and add `TRUST_PROXY=false` to `.env.example`.

- [ ] **Step 3: Add failing effective-host tests**

```ts
assert.equal(effectiveHostname({ host: "tenant-a.localhost:3001" }, false), "tenant-a.localhost");
assert.equal(effectiveHostname({ host: "api.internal", "x-forwarded-host": "tenant-a.example.com" }, false), "api.internal");
assert.equal(effectiveHostname({ host: "api.internal", "x-forwarded-host": "tenant-a.example.com, proxy.internal" }, true), "tenant-a.example.com");
```

Select the first forwarded value only with proxy trust, lowercase, trim, and strip numeric port.

- [ ] **Step 4: Write middleware tests**

Assert effective hostname is sent to the use case, resolved tenant nests context with `tenantId`, unresolved tenant calls `next()` unchanged, client body/query/header tenant values are ignored, and no Prisma dependency exists.

- [ ] **Step 5: Implement middleware**

Do not inject `PrismaService` or a concrete adapter. Call `ResolveTenantUseCase` only.

- [ ] **Step 6: Add and implement guard tests**

Metadata absent returns `true`; metadata present with tenant returns `true`; metadata present without tenant throws:

```ts
new NotFoundException("Tenant context could not be resolved")
```

- [ ] **Step 7: Compose directory port and guard**

Register:

```ts
{
  provide: TENANT_DIRECTORY_PORT,
  useClass: PrismaTenantDirectoryAdapter,
},
{
  provide: ResolveTenantUseCase,
  inject: [TENANT_DIRECTORY_PORT],
  useFactory: (directory: TenantDirectoryPort) => new ResolveTenantUseCase(directory),
}
```

Register `TenantRequiredGuard` with `APP_GUARD`. Do not apply database-backed middleware yet; Task 6 applies it to the new controller. Update `AppModule` to import `./modules/tenancy/tenancy.module.js`.

- [ ] **Step 8: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/config/environment.schema.test.ts \
  src/modules/tenancy/infrastructure/http/effective-hostname.test.ts \
  src/modules/tenancy/infrastructure/http/tenant-resolution.middleware.test.ts \
  src/modules/tenancy/infrastructure/http/tenant-required.guard.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add apps/api/.env.example apps/api/src/config apps/api/src/modules/tenancy apps/api/src/app.module.ts
git commit -m "feat: add tenant HTTP adapters"
```

---

### Task 5: Define Transaction Capabilities and Prisma Adapters

**Files:**
- Create: `apps/api/src/modules/tenancy/application/ports/tenant-probe-repository.port.ts`
- Create: `apps/api/src/modules/tenancy/application/ports/tenant-transaction.port.ts`
- Create: `apps/api/src/modules/tenancy/application/ports/tenant-transaction.port.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-probe-repository.adapter.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-probe-repository.adapter.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.test.ts`
- Modify: `apps/api/src/modules/tenancy/tenancy.module.ts`

**Interfaces:**

```ts
export interface TenantProbeRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly value: string;
}
export interface TenantProbeRepositoryPort {
  list(): Promise<readonly TenantProbeRecord[]>;
}
export interface TenantDataSession {
  readonly tenantProbes: TenantProbeRepositoryPort;
}
export interface TenantTransactionPort {
  run<T>(
    context: TenantExecutionContext,
    work: (session: TenantDataSession) => Promise<T>,
  ): Promise<T>;
}
```

- [ ] **Step 1: Write failing port compilation test**

Construct fake `TenantProbeRepositoryPort`, `TenantDataSession`, and `TenantTransactionPort` values and execute a callback. The test imports no Prisma or NestJS.

- [ ] **Step 2: Write failing repository-adapter test**

Assert `list()` calls exactly:

```ts
transaction.tenantProbe.findMany({
  orderBy: { id: "asc" },
  select: { id: true, tenantId: true, value: true },
});
```

- [ ] **Step 3: Implement repository adapter**

The constructor receives `Prisma.TransactionClient`, but the public interface is `TenantProbeRepositoryPort`. Keep all Prisma types inside infrastructure.

- [ ] **Step 4: Write failing transaction-adapter tests**

Cover malformed tenant before `$transaction`, role before `set_config`, callback receives only `{ tenantProbes }`, repository capability uses the active transaction, same-tenant nesting reuses session, different-tenant nesting throws `TenantContextConflictError`, and callback failure propagates.

- [ ] **Step 5: Implement active session and transaction**

Use private `AsyncLocalStorage`:

```ts
interface ActiveTenantSession {
  readonly context: TenantExecutionContext;
  readonly session: TenantDataSession;
}
```

Inside Prisma transaction:

```ts
await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${context.tenantId}, true)`;
const session = Object.freeze({
  tenantProbes: new PrismaTenantProbeRepositoryAdapter(transaction),
});
```

- [ ] **Step 6: Bind transaction port**

Register `TENANT_TRANSACTION_PORT` to `PrismaTenantTransactionAdapter`. Do not export the concrete adapter.

- [ ] **Step 7: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/application/ports/tenant-transaction.port.test.ts \
  src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-probe-repository.adapter.test.ts \
  src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add apps/api/src/modules/tenancy
git commit -m "feat: add hexagonal tenant transaction adapters"
```

---

### Task 6: Complete the Tenant-Probe Vertical Slice

**Files:**
- Create: `apps/api/src/modules/tenancy/application/use-cases/list-tenant-probes.use-case.ts`
- Create: `apps/api/src/modules/tenancy/application/use-cases/list-tenant-probes.use-case.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-probe.controller.ts`
- Modify: `apps/api/src/modules/tenancy/tenancy.module.ts`
- Create: `apps/api/test/tenant-probe.e2e.test.ts`
- Modify: `apps/api/test/tenant-isolation.e2e.test.ts`
- Delete: `apps/api/src/tenancy/tenant-context.ts`
- Delete: `apps/api/src/tenancy/tenant-context.service.ts`
- Delete: `apps/api/src/tenancy/tenant-probe.controller.ts`
- Delete: `apps/api/src/tenancy/tenant-resolution.middleware.ts`
- Delete: `apps/api/src/tenancy/tenancy.module.ts`

**Interface:**

```ts
export class ListTenantProbesUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}
  execute(context: TenantExecutionContext): Promise<readonly TenantProbeRecord[]>;
}
```

- [ ] **Step 1: Write failing use-case test**

Use a fake transaction port that calls the callback with a fake `tenantProbes.list()`. Assert exact context forwarding and returned records.

- [ ] **Step 2: Implement use case**

```ts
execute(context: TenantExecutionContext): Promise<readonly TenantProbeRecord[]> {
  return this.transactions.run(context, (session) => session.tenantProbes.list());
}
```

No NestJS or Prisma imports.

- [ ] **Step 3: Write controller and E2E tests before implementation**

Preserve the existing internal route and test-only bearer authorization. Assert the controller reads trusted context, narrows it, calls the use case, and returns records. E2E covers tenant A, tenant B, missing tenant, and invalid authorization.

- [ ] **Step 4: Implement controller as inbound adapter**

The controller imports `RequestContextStorage`, `requireTenantExecutionContext`, and `ListTenantProbesUseCase`. It contains no Prisma or transaction code and is decorated with `@TenantRequired()`.

- [ ] **Step 5: Wire use case, controller, and middleware route**

Construct `ListTenantProbesUseCase` from `TENANT_TRANSACTION_PORT`, register the controller, and apply tenant middleware only to this controller.

- [ ] **Step 6: Replace old test imports and remove old module**

```bash
rg 'src/tenancy|\.\/tenancy|\.\.\/tenancy' apps/api/src apps/api/test
```

Update every result to `src/modules/tenancy` paths, then delete the old files.

- [ ] **Step 7: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/application/use-cases/list-tenant-probes.use-case.test.ts \
  test/tenant-probe.e2e.test.ts \
  test/tenant-isolation.e2e.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add apps/api/src apps/api/test
git commit -m "refactor: complete tenant probe hexagonal slice"
```

---

### Task 7: Complete Isolation, Concurrency, and HTTP Coverage

**Files:**
- Modify: `apps/api/test/tenant-isolation.e2e.test.ts`
- Create: `apps/api/test/tenant-context-concurrency.e2e.test.ts`
- Create: `apps/api/test/tenant-resolution.e2e.test.ts`

- [ ] **Step 1: Expand RLS CRUD matrix**

Add tenant A against tenant B cases for list, primary-key lookup, raw select, insert, update, updateMany, delete, deleteMany, upsert, and raw update. Assert null, zero count, or rejection without matching complete PostgreSQL error text.

- [ ] **Step 2: Add commit and rollback cases**

A successful transaction persists. A create followed by a thrown sentinel error rolls back. A malformed tenant ID rejects before Prisma `$transaction`.

- [ ] **Step 3: Add parallel leakage test**

Run at least 20 interleaved tenant A/B operations, cross an async boundary, and assert every response contains only its active tenant. Then run A → B → missing-context sequentially to prove AsyncLocalStorage and `SET LOCAL` state do not leak.

- [ ] **Step 4: Add HTTP E2E cases**

Cover tenant A host, tenant B host, unknown host, missing host, malicious body/query/header tenant IDs, `TRUST_PROXY=false`, `TRUST_PROXY=true`, health, and readiness.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  test/tenant-isolation.e2e.test.ts \
  test/tenant-context-concurrency.e2e.test.ts \
  test/tenant-resolution.e2e.test.ts \
  test/health.e2e.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add apps/api/test
git commit -m "test: complete tenant isolation matrix"
```

---

### Task 8: Add Fail-Closed Tenant Policy Verification

**Files:**
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-verifier.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-verifier.test.ts`
- Create: `apps/api/scripts/verify-tenant-policies.ts`
- Modify: `apps/api/package.json`
- Modify: `scripts/verify-migrations.mjs`

**Interfaces:**

```ts
export interface TenantOwnedTablePolicy {
  readonly table: string;
  readonly tenantColumn: string;
  readonly tenantColumnNullable: boolean;
  readonly applicationRole: string;
}
export async function verifyTenantPolicies(
  client: Pick<PoolClient, "query">,
  manifest: readonly TenantOwnedTablePolicy[],
): Promise<readonly string[]>;
```

- [ ] **Step 1: Write failing catalog tests**

Cover valid table, missing table, missing tenant column, incorrect nullability, missing index, RLS disabled, FORCE RLS disabled, missing policy, missing `USING`, missing `WITH CHECK`, superuser application role, BYPASSRLS, and excessive grants.

- [ ] **Step 2: Run and observe failure**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/infrastructure/persistence/tenant-policy-verifier.test.ts
```

- [ ] **Step 3: Implement catalog inspection**

Query `pg_class`, `information_schema.columns`, `pg_indexes`, `pg_policies`, `information_schema.role_table_grants`, and `pg_roles`. Require policy expressions to reference:

```sql
current_setting('app.tenant_id', true)
```

Declare `tenant_probes` with `tenantColumnNullable: false` and `outbox_events` with `tenantColumnNullable: true` according to its accepted mixed-scope migration.

- [ ] **Step 4: Add executable command**

Add:

```json
"verify:tenant-policies": "tsx scripts/verify-tenant-policies.ts"
```

The script reads `MIGRATION_DATABASE_URL` or `DATABASE_URL`, creates `pg.Pool`, prints failures, exits non-zero, prints `Tenant policy verification PASS.` on success, and closes in `finally`.

- [ ] **Step 5: Wire migration verification**

After deploy/status/diff and after previous-schema upgrade, run:

```js
run(["--filter", "@booking-os/api", "verify:tenant-policies"], migrationEnvironment);
```

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/infrastructure/persistence/tenant-policy-verifier.test.ts
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm verify:architecture
git add apps/api/src/modules/tenancy/infrastructure/persistence apps/api/scripts apps/api/package.json scripts/verify-migrations.mjs
git commit -m "feat: verify tenant RLS policy invariants"
```

---

### Task 9: Isolate Privileged Worker Database Access

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

This Prisma-bearing interface is allowed because it remains inside worker infrastructure, not API application core.

- [ ] **Step 1: Write failing wrapper tests**

Assert one transaction, `SET LOCAL ROLE booking_worker` first, callback receives transaction, errors propagate, and no caller-provided role parameter exists.

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

Do not export a generic `runAsRole`.

- [ ] **Step 3: Refactor Outbox repository and providers**

`PrismaOutboxRepository` receives `WorkerDatabase`; providers keep raw Prisma only for connection lifecycle and construct the wrapper inside `worker-critical`.

- [ ] **Step 4: Add safety and integration tests**

Logs include safe event ID, type, and optional tenant ID but exclude payload and credentials. API application role cannot alter another tenant's Outbox rows. Worker integration proves approved cross-tenant claim and state transitions.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @booking-os/worker-critical exec node --test --import tsx \
  src/database/worker-database.test.ts \
  src/outbox/outbox-dispatcher.test.ts \
  src/outbox/prisma-outbox.repository.integration.test.ts
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/reliability/outbox.repository.integration.test.ts
pnpm --filter @booking-os/worker-critical typecheck
pnpm --filter @booking-os/api typecheck
pnpm verify:architecture
git add apps/worker-critical/src apps/api/src/reliability/outbox.repository.integration.test.ts
git commit -m "refactor: isolate privileged worker database access"
```

---

### Task 10: Documentation and Full Acceptance Gate

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/foundation-recovery.md`
- Review: `docs/adr/ADR-0007-hexagonal-api-module-boundaries.md`
- Review: `docs/features/FEATURE-0001-tenant-isolation-core.md`
- Review: `docs/patterns/PATTERN-0001-tenant-scoped-transaction.md`
- Review: `docs/patterns/PATTERN-0002-hexagonal-api-module.md`
- Review: `docs/superpowers/specs/2026-08-05-tenant-isolation-core-design.md`

- [ ] **Step 1: Document module usage**

Show:

```ts
return this.transactions.run(context, (session) =>
  session.tenantProbes.list(),
);
```

Document that controllers call use cases, middleware calls `ResolveTenantUseCase`, Prisma stays under `infrastructure/persistence/prisma`, and `TRUST_PROXY=false` is the default.

- [ ] **Step 2: Document architecture verification**

Add `pnpm verify:architecture` and explain domain, application, infrastructure, composition-root, and cross-module rules. An accepted ADR is required for exceptions.

- [ ] **Step 3: Extend recovery runbook**

Add tenant-context and tenant-policy diagnosis using request ID, trace ID, effective host, read-only PostgreSQL catalog checks, architecture verification, and migration verification. Forbid disabling RLS, granting BYPASSRLS, editing applied migrations, importing infrastructure to bypass a port, or ad-hoc tenant data repair.

- [ ] **Step 4: Run repository-wide gates**

```bash
pnpm format
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:api
pnpm verify:architecture
pnpm genesis:validate
pnpm api:check-generated
pnpm verify:migrations
pnpm verify:foundation
pnpm build
```

When required locally:

```bash
go install github.com/oasdiff/oasdiff@v1.17.0
pnpm api:verify-compatibility-fixtures
```

- [ ] **Step 5: Verify forbidden imports directly**

```bash
rg '@nestjs/|@prisma/client|/infrastructure/' \
  apps/api/src/modules/tenancy/domain \
  apps/api/src/modules/tenancy/application
```

Expected: no matches.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md docs
git commit -m "docs: complete tenant isolation operating guidance"
```

- [ ] **Step 7: Record final evidence**

```bash
git status --short
git log --oneline --decorate -12
git diff --check main...HEAD
```

Expected: clean worktree, focused task commits, and no whitespace errors.
