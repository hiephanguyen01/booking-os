# Tenant Isolation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Sprint 0 RLS proof into a fail-closed tenant boundary and establish enforceable Hexagonal Architecture rules for new and touched `apps/api` modules.

**Architecture:** The tenancy module is reorganized into domain, application, and infrastructure zones. HTTP adapters call application use cases, application code depends on technology-neutral ports, and Prisma adapters implement those ports. `PrismaTenantTransactionAdapter` owns PostgreSQL role/context setup and supplies a `TenantDataSession` capability object rather than exposing `Prisma.TransactionClient`.

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
│   └── tenant-id.test.ts
├── application/
│   ├── ports/
│   │   ├── tenant-directory.port.ts
│   │   ├── tenant-probe-repository.port.ts
│   │   └── tenant-transaction.port.ts
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
│   │   ├── tenant-host.ts
│   │   ├── tenant-host.test.ts
│   │   ├── tenant-probe.controller.ts
│   │   ├── tenant-required.decorator.ts
│   │   ├── tenant-required.guard.ts
│   │   ├── tenant-required.guard.test.ts
│   │   └── tenant-resolution.middleware.ts
│   └── persistence/
│       └── prisma/
│           ├── prisma-tenant-directory.adapter.ts
│           ├── prisma-tenant-directory.adapter.test.ts
│           ├── prisma-tenant-probe-repository.adapter.ts
│           ├── prisma-tenant-probe-repository.adapter.test.ts
│           ├── prisma-tenant-transaction.adapter.ts
│           └── prisma-tenant-transaction.adapter.test.ts
└── tenancy.module.ts
```

The existing `apps/api/src/tenancy/` files are deleted only after replacements compile and focused tests pass.

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
- Manifest initially declares `apps/api/src/modules/tenancy` as a strict hexagonal module.

- [ ] **Step 1: Write failing architecture-fixture tests**

Create temporary module trees inside the test and assert these cases:

```js
const valid = {
  "domain/entity.ts": "export interface Entity { readonly id: string }",
  "application/ports/repository.port.ts":
    'import type { Entity } from "../../domain/entity.js"; export interface RepositoryPort { find(): Promise<Entity | null> }',
  "infrastructure/persistence/prisma.adapter.ts":
    'import type { RepositoryPort } from "../../application/ports/repository.port.js"; export class Adapter implements RepositoryPort { async find() { return null; } }',
};
```

Invalid fixtures must be detected for:

- domain importing `@nestjs/common`;
- domain importing `@prisma/client`;
- application importing `@prisma/client`;
- application importing `../infrastructure/...`;
- application port containing `Prisma.TransactionClient`;
- one module importing another module's `/infrastructure/` path.

- [ ] **Step 2: Run and observe missing-verifier failure**

```bash
node --test scripts/architecture/api-module-boundaries.test.mjs
```

Expected: FAIL because the verifier and manifest do not exist.

- [ ] **Step 3: Implement deterministic import scanning**

Use Node `fs`, `path`, and regular expressions over static `import` and `export ... from` declarations. For each `.ts` file under a declared module:

- classify relative path as `domain`, `application`, `infrastructure`, or composition root;
- collect module specifiers;
- reject forbidden package and relative imports by zone;
- reject application-port source containing adapter-specific type names;
- return sorted strings in `<relative-file>: <message>` format.

Use these exact forbidden package prefixes:

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

Composition-root files may import every zone inside their own module.

- [ ] **Step 4: Add executable command and CI step**

Add to root `package.json`:

```json
"verify:architecture": "node scripts/architecture/api-module-boundaries.mjs"
```

The executable imports the manifest, prints every failure, exits `1` on violations, and prints `API module boundary verification PASS.` on success.

Add a permanent CI step after Genesis validation:

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

### Task 2: Define Trusted Context and Technology-Neutral Domain Types

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
  assert.equal(request.source, "internal");
  assert.equal(request.tenantId, tenant.tenantId);
});
```

- [ ] **Step 2: Run and observe the contract failure**

```bash
pnpm --filter @booking-os/contracts test
```

Expected: FAIL because `source` and `TenantExecutionContext` do not exist.

- [ ] **Step 3: Implement the shared contract and fixed HTTP source**

Update the middleware storage call to:

```ts
this.storage.run({ requestId, traceId, source: "internal" }, next);
```

Add a middleware test proving headers named `x-source`, `x-tenant-id`, and `x-actor-id` do not populate trusted fields.

- [ ] **Step 4: Write failing domain/application tests**

Cover:

- valid RFC-4122 UUID accepted;
- malformed UUID throws `InvalidTenantContextError`;
- missing tenant ID throws `TenantContextUnavailableError`;
- a valid request context narrows without mutation;
- returned context is frozen or already immutable by storage contract.

- [ ] **Step 5: Implement validation and errors without framework imports**

`tenant-id.ts` contains only the UUID regex and validation function. Error classes extend `Error` and set stable `name` values. `tenant-execution-context.ts` imports only contracts, domain validation, and application errors.

- [ ] **Step 6: Run architecture and focused tests, then commit**

```bash
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/common/request-context/request-context.middleware.test.ts \
  src/modules/tenancy/domain/tenant-id.test.ts \
  src/modules/tenancy/application/tenant-execution-context.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add packages/contracts apps/api/src/common/request-context apps/api/src/modules/tenancy
git commit -m "feat: define trusted tenant context contracts"
```

---

### Task 3: Implement the Tenant Directory Port and Resolution Use Case

**Files:**
- Create: `apps/api/src/modules/tenancy/application/ports/tenant-directory.port.ts`
- Create: `apps/api/src/modules/tenancy/application/use-cases/resolve-tenant.use-case.ts`
- Create: `apps/api/src/modules/tenancy/application/use-cases/resolve-tenant.use-case.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-host.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-host.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-directory.adapter.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-directory.adapter.test.ts`

**Interfaces:**

```ts
export interface TenantDirectoryPort {
  findActiveBySlug(slug: string): Promise<ResolvedTenant | null>;
}

export class ResolveTenantUseCase {
  constructor(private readonly tenants: TenantDirectoryPort) {}
  execute(hostname: string): Promise<ResolvedTenant | null>;
}
```

- [ ] **Step 1: Write failing hostname tests**

```ts
assert.equal(tenantSlugFromHostname("tenant-a.example.com"), "tenant-a");
assert.equal(tenantSlugFromHostname("TENANT-A.EXAMPLE.COM"), "tenant-a");
assert.equal(tenantSlugFromHostname("-invalid.example.com"), undefined);
assert.equal(tenantSlugFromHostname("127.0.0.1"), undefined);
assert.equal(tenantSlugFromHostname("localhost"), undefined);
```

- [ ] **Step 2: Implement pure hostname-to-slug parsing**

The function lowercases and trims input, rejects IPs and malformed labels, and returns only a slug matching:

```ts
/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
```

This file imports no NestJS or Prisma.

- [ ] **Step 3: Write failing use-case tests with a fake port**

Use an object literal implementing `TenantDirectoryPort`. Assert valid host calls `findActiveBySlug("tenant-a")` once, invalid host returns `null` without calling the port, and the use case returns the port result unchanged.

- [ ] **Step 4: Implement the port and use case**

Keep input and result technology-neutral. The use case imports the pure hostname function and the application port only.

- [ ] **Step 5: Write failing Prisma adapter test**

Use a fake `PrismaService` shape and assert:

```ts
prisma.tenant.findUnique({
  where: { slug: "tenant-a" },
  select: { id: true, slug: true },
});
```

Returns `null` or `{ id, slug }` without exposing a Prisma model type.

- [ ] **Step 6: Implement the adapter and run focused tests**

The adapter is `@Injectable()`, implements `TenantDirectoryPort`, and is the only file in this task importing `PrismaService`.

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/infrastructure/http/tenant-host.test.ts \
  src/modules/tenancy/application/use-cases/resolve-tenant.use-case.test.ts \
  src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-directory.adapter.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add apps/api/src/modules/tenancy
git commit -m "feat: resolve tenants through an application port"
```

---

### Task 4: Build the HTTP Inbound Adapters and Composition Root

**Files:**
- Modify: `apps/api/src/config/environment.schema.ts`
- Modify: `apps/api/src/config/environment.schema.test.ts`
- Modify: `apps/api/.env.example`
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

Assert default `false`, explicit `"true"` becomes `true`, explicit `"false"` remains `false`, and any other string fails environment parsing.

- [ ] **Step 2: Parse and document `TRUST_PROXY`**

Add a strict enum field defaulting to `"false"`, transform it to `trustProxy: boolean`, and add `TRUST_PROXY=false` to `.env.example`.

- [ ] **Step 3: Add failing effective-host tests**

```ts
assert.equal(effectiveHostname({ host: "tenant-a.localhost:3001" }, false), "tenant-a.localhost");
assert.equal(effectiveHostname({ host: "api.internal", "x-forwarded-host": "tenant-a.example.com" }, false), "api.internal");
assert.equal(effectiveHostname({ host: "api.internal", "x-forwarded-host": "tenant-a.example.com, proxy.internal" }, true), "tenant-a.example.com");
```

Select the first comma-separated forwarded value only when proxy trust is enabled. Lowercase, trim, and remove a numeric port.

- [ ] **Step 4: Write middleware tests before implementation**

Use fakes for the use case and context storage. Assert:

- the effective hostname is passed to `ResolveTenantUseCase.execute`;
- a resolved tenant nests downstream execution with `{ ...current, tenantId }`;
- unknown/invalid tenant calls `next()` without tenant enrichment;
- request body/query/header tenant values are ignored;
- no constructor parameter or import references Prisma.

- [ ] **Step 5: Implement middleware as a pure inbound adapter**

Do not inject `PrismaService` or the directory adapter. The middleware calls the use case only.

- [ ] **Step 6: Add and implement tenant-required guard tests**

Metadata absent returns `true`; metadata present with tenant returns `true`; metadata present without tenant throws:

```ts
new NotFoundException("Tenant context could not be resolved")
```

The guard uses `Reflector` and `RequestContextStorage` only.

- [ ] **Step 7: Compose ports and adapters in `TenancyModule`**

Use symbol tokens in `tenancy.tokens.ts`. Register:

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

Register the guard as `APP_GUARD`. Keep database-backed tenant middleware scoped to tenant-aware controllers rather than `"*"` so liveness does not depend on PostgreSQL.

Update `AppModule` to import `./modules/tenancy/tenancy.module.js`.

- [ ] **Step 8: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/config/environment.schema.test.ts \
  src/modules/tenancy/infrastructure/http/tenant-host.test.ts \
  src/modules/tenancy/infrastructure/http/tenant-resolution.middleware.test.ts \
  src/modules/tenancy/infrastructure/http/tenant-required.guard.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add apps/api/.env.example apps/api/src/config apps/api/src/modules/tenancy apps/api/src/app.module.ts
git commit -m "feat: add tenant HTTP adapters and composition root"
```

---

### Task 5: Define the Transaction Port and Prisma Transaction Adapter

**Files:**
- Create: `apps/api/src/modules/tenancy/application/ports/tenant-probe-repository.port.ts`
- Create: `apps/api/src/modules/tenancy/application/ports/tenant-transaction.port.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.test.ts`
- Modify: `apps/api/src/modules/tenancy/tenancy.tokens.ts`
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

- [ ] **Step 1: Write a compile-time architecture test for the ports**

Import the port types in a Node test, construct fakes, and assert the source files contain none of these strings:

```ts
["@prisma/client", "Prisma.", "TransactionClient", "@nestjs/"]
```

The repository method has no transaction parameter.

- [ ] **Step 2: Write failing Prisma transaction adapter tests**

Cover exact behavior:

- malformed tenant rejects before `$transaction` is called;
- `SET LOCAL ROLE booking_app` occurs before `set_config`;
- callback receives `{ tenantProbes }`, not the raw transaction;
- the repository capability is constructed with the active transaction;
- same-tenant nested call reuses one transaction and the same session;
- different-tenant nested call throws `TenantContextConflictError`;
- callback failure propagates so Prisma rolls back;
- completed callbacks cannot retrieve an active session.

- [ ] **Step 3: Implement active-session storage**

Use private `AsyncLocalStorage` inside the adapter:

```ts
interface ActiveTenantSession {
  readonly context: TenantExecutionContext;
  readonly session: TenantDataSession;
}
```

The adapter opens Prisma transaction only when no active session exists. For a nested call, compare tenant IDs and either reuse or throw.

- [ ] **Step 4: Construct technology-neutral capabilities**

Inside the Prisma transaction callback:

```ts
const session: TenantDataSession = Object.freeze({
  tenantProbes: new PrismaTenantProbeRepositoryAdapter(transaction),
});
```

The adapter file may import Prisma and the concrete repository adapter. Application files may not.

- [ ] **Step 5: Bind the application port**

Register `TENANT_TRANSACTION_PORT` to `PrismaTenantTransactionAdapter` in `TenancyModule`. Do not export the concrete adapter outside the module.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/application/ports/tenant-transaction.port.test.ts \
  src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.test.ts
pnpm verify:architecture
pnpm --filter @booking-os/api typecheck
git add apps/api/src/modules/tenancy
git commit -m "feat: add hexagonal tenant transaction adapter"
```

---

### Task 6: Complete the Tenant-Probe Hexagonal Vertical Slice

**Files:**
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-probe-repository.adapter.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-probe-repository.adapter.test.ts`
- Create: `apps/api/src/modules/tenancy/application/use-cases/list-tenant-probes.use-case.ts`
- Create: `apps/api/src/modules/tenancy/application/use-cases/list-tenant-probes.use-case.test.ts`
- Create: `apps/api/src/modules/tenancy/infrastructure/http/tenant-probe.controller.ts`
- Modify: `apps/api/src/modules/tenancy/tenancy.module.ts`
- Modify: `apps/api/test/tenant-probe.e2e.test.ts` if present; otherwise create it.
- Delete: `apps/api/src/tenancy/tenant-context.ts`
- Delete: `apps/api/src/tenancy/tenant-context.service.ts`
- Delete: `apps/api/src/tenancy/tenant-probe.controller.ts`
- Delete: `apps/api/src/tenancy/tenant-resolution.middleware.ts`
- Delete: `apps/api/src/tenancy/tenancy.module.ts`

**Interfaces:**

```ts
export class ListTenantProbesUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}
  execute(context: TenantExecutionContext): Promise<readonly TenantProbeRecord[]>;
}
```

- [ ] **Step 1: Write failing repository-adapter test**

Assert `list()` calls exactly:

```ts
transaction.tenantProbe.findMany({
  orderBy: { id: "asc" },
  select: { id: true, tenantId: true, value: true },
});
```

The adapter constructor receives Prisma transaction infrastructure, but its public interface is `TenantProbeRepositoryPort`.

- [ ] **Step 2: Implement the Prisma repository adapter**

Keep all Prisma types inside `infrastructure/persistence/prisma`.

- [ ] **Step 3: Write failing use-case test using fake transaction port**

The fake calls the callback with:

```ts
const session: TenantDataSession = {
  tenantProbes: {
    list: async () => [{ id: "probe-1", tenantId, value: "visible" }],
  },
};
```

Assert the use case passes the exact context to `transactions.run` and returns `session.tenantProbes.list()`.

- [ ] **Step 4: Implement the use case**

```ts
execute(context: TenantExecutionContext): Promise<readonly TenantProbeRecord[]> {
  return this.transactions.run(context, (session) => session.tenantProbes.list());
}
```

No NestJS or Prisma imports are allowed.

- [ ] **Step 5: Implement controller as inbound adapter**

Preserve the existing test-only authorization and internal route visibility. The controller:

- reads trusted context from `RequestContextStorage`;
- narrows with `requireTenantExecutionContext`;
- invokes `ListTenantProbesUseCase.execute(context)`;
- contains no Prisma or transaction logic;
- is decorated with `@TenantRequired()`.

- [ ] **Step 6: Wire use case and middleware route**

Construct `ListTenantProbesUseCase` from `TENANT_TRANSACTION_PORT`. Register the controller and apply tenant resolution middleware only to this controller.

- [ ] **Step 7: Remove superseded tenancy files after tests pass**

Search for imports before deletion:

```bash
rg 'src/tenancy|\.\/tenancy|\.\.\/tenancy' apps/api/src apps/api/test
```

Update every remaining import to `src/modules/tenancy` paths, then remove the old directory.

- [ ] **Step 8: Run and commit**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-probe-repository.adapter.test.ts \
  src/modules/tenancy/application/use-cases/list-tenant-probes.use-case.test.ts \
  test/tenant-probe.e2e.test.ts
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
- Modify: test helpers under `apps/api/test/` only when shared setup removes duplication.

**Interfaces:**
- Tests execute tenant-owned work through `TenantTransactionPort` or the public HTTP adapter path, never by importing the Prisma transaction adapter from application code.

- [ ] **Step 1: Expand the RLS CRUD matrix**

Add tenant A against tenant B cases for list, primary-key lookup, raw select, insert, update, updateMany, delete, deleteMany, upsert, and raw update. Assert null, zero count, or rejection according to Prisma behavior without matching complete PostgreSQL error text.

- [ ] **Step 2: Add commit and rollback cases**

A successful transaction persists. A create followed by a thrown sentinel error rolls back. A malformed tenant ID rejects before the fake or real Prisma `$transaction` call.

- [ ] **Step 3: Add parallel context-leakage test**

Run at least 20 interleaved tenant A/B operations. Cross an async scheduling boundary with `setImmediate` or `Promise.resolve()`. Assert each response contains only its active tenant's rows.

Then run A → B → missing-context sequentially to prove AsyncLocalStorage and transaction-local `SET LOCAL` state do not leak through pooled connections.

- [ ] **Step 4: Add HTTP E2E cases**

Cover:

- tenant A host;
- tenant B host;
- unknown host;
- missing host;
- body/query/header values attempting to select tenant B during tenant A request;
- `TRUST_PROXY=false` ignoring forwarded host;
- `TRUST_PROXY=true` accepting first trusted forwarded host;
- health and readiness without tenant context.

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
  readonly applicationRole: string;
}

export async function verifyTenantPolicies(
  client: Pick<PoolClient, "query">,
  manifest: readonly TenantOwnedTablePolicy[],
): Promise<readonly string[]>;
```

- [ ] **Step 1: Write failing verifier tests with catalog fakes**

Fixtures cover:

- valid table;
- missing table;
- missing `tenant_id`;
- nullable tenant column when manifest requires non-null;
- missing tenant index;
- RLS disabled;
- FORCE RLS disabled;
- missing policy;
- missing `USING` expression;
- missing `WITH CHECK` expression;
- `booking_app` superuser;
- `booking_app` with BYPASSRLS;
- excessive grants.

Assert failures are sorted and include table/role names.

- [ ] **Step 2: Run and observe missing-verifier failure**

```bash
pnpm --filter @booking-os/api exec node --test --import tsx \
  src/modules/tenancy/infrastructure/persistence/tenant-policy-verifier.test.ts
```

- [ ] **Step 3: Implement PostgreSQL catalog inspection**

Query:

- `pg_class.relrowsecurity` and `relforcerowsecurity`;
- `information_schema.columns`;
- `pg_indexes`;
- `pg_policies.qual` and `with_check`;
- `information_schema.role_table_grants`;
- `pg_roles.rolsuper` and `rolbypassrls`.

Require policy expressions to reference:

```sql
current_setting('app.tenant_id', true)
```

The manifest initially declares `tenant_probes` and the tenant-bound behavior of `outbox_events` according to its accepted mixed-scope migration.

- [ ] **Step 4: Add executable command**

Add to API scripts:

```json
"verify:tenant-policies": "tsx scripts/verify-tenant-policies.ts"
```

The script reads `MIGRATION_DATABASE_URL` or `DATABASE_URL`, creates `pg.Pool`, prints all failures, exits non-zero on violation, prints `Tenant policy verification PASS.` on success, and closes the pool in `finally`.

- [ ] **Step 5: Wire migration verification**

After deploy/status/diff, run:

```js
run(["--filter", "@booking-os/api", "verify:tenant-policies"], migrationEnvironment);
```

Run it again after upgrading the previous-schema database.

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

This Prisma-bearing interface is allowed because `worker-critical/src/database` is infrastructure, not API application core.

- [ ] **Step 1: Write failing worker-wrapper tests**

Assert one transaction, `SET LOCAL ROLE booking_worker` runs first, callback receives the transaction, errors propagate, and no caller-provided role parameter exists.

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

Assert logs include safe `eventId`, event type, and optional tenant ID but exclude payload and credentials. API application-role tests prove one tenant cannot alter another tenant's Outbox rows. Worker integration proves `claimBatch`, `markDispatched`, and `markFailed` operate across approved rows.

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

Show an application use case depending on ports:

```ts
return this.transactions.run(context, (session) =>
  session.tenantProbes.list(),
);
```

Show that controllers call use cases, middleware calls `ResolveTenantUseCase`, and Prisma remains under `infrastructure/persistence/prisma`.

Document `TRUST_PROXY=false` as default and enable forwarded host only behind a controlled proxy.

- [ ] **Step 2: Document architecture verification**

Add:

```bash
pnpm verify:architecture
```

Explain the domain, application, infrastructure, composition-root, and cross-module rules. State that an accepted ADR is required for exceptions.

- [ ] **Step 3: Extend recovery runbook**

Add tenant-context and tenant-policy diagnosis using request ID, trace ID, effective host, read-only PostgreSQL catalog checks, `pnpm verify:architecture`, and `pnpm verify:migrations`.

Explicitly forbid disabling RLS, granting BYPASSRLS, editing applied migrations, importing infrastructure to bypass a port, or repairing tenant data with ad-hoc SQL.

- [ ] **Step 4: Run focused and repository-wide gates**

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

Install and run the pinned OpenAPI compatibility tool when required by the local environment:

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

Expected: no matches except test strings deliberately used to validate the architecture verifier; those fixtures live under `scripts/architecture`, not the module.

- [ ] **Step 6: Commit final documentation**

```bash
git add README.md docs apps/api apps/worker-critical scripts package.json .github/workflows/ci.yml
git commit -m "docs: complete tenant isolation operating guidance"
```

- [ ] **Step 7: Final branch evidence**

Record:

```bash
git status --short
git log --oneline --decorate -12
git diff --check main...HEAD
```

Expected: clean worktree, focused task commits, and no whitespace errors.
