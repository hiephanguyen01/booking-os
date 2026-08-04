# Sprint 1A Tenant Isolation Core Design

Date: 2026-08-05
Status: Approved design, revised for Hexagonal Architecture
Owner: tenancy

## Summary

Sprint 1A converts the Sprint 0 tenant-isolation proof into a production-grade execution boundary and establishes the first enforceable Hexagonal Architecture pattern for `apps/api`.

Every tenant-owned operation runs through an application-owned transaction port under the `booking_app` role. PostgreSQL FORCE RLS remains the final enforcement layer. Application callbacks receive technology-neutral repository capabilities rather than `Prisma.TransactionClient`. HTTP middleware and guards are inbound adapters, Prisma implementations are outbound adapters, NestJS modules are composition roots, and CI verifies schema, policy, role, context isolation, and dependency direction.

This slice excludes authentication, membership, RBAC, onboarding UI, and booking-domain behavior. Those capabilities will build on these boundaries in later slices.

## Current State

Sprint 0 already provides:

- host-based tenant resolution;
- AsyncLocalStorage carrying a resolved tenant ID;
- a Prisma transaction wrapper that sets `SET LOCAL ROLE booking_app` and transaction-local `app.tenant_id`;
- FORCE RLS for `tenant_probes` and tenant-bound `outbox_events`;
- a privileged `booking_worker` role for infrastructure relay work;
- isolation tests for cross-tenant reads, inserts, and primary-key lookup.

The proof intentionally couples infrastructure details:

- tenant middleware queries Prisma directly;
- transaction callbacks receive `Prisma.TransactionClient`;
- repository contracts may expose Prisma transaction types;
- NestJS, application orchestration, and persistence live in the same directory boundary.

Those choices must not become the template copied by later product modules.

## Goals

1. Establish an explicit trusted execution context for HTTP and worker operations.
2. Establish a minimal Hexagonal Architecture rule for new and touched API modules.
3. Resolve tenants through an application use case and tenant-directory port.
4. Execute tenant-owned work through an application transaction port and technology-neutral capability session.
5. Keep Prisma, PostgreSQL role commands, NestJS delivery concerns, and worker privilege in infrastructure adapters.
6. Prevent tenant switching, missing context, and context leakage.
7. Classify global, tenant-owned, and privileged infrastructure data paths.
8. Fail CI when dependency direction, tenant schema, policy, or role invariants regress.
9. Preserve all Sprint 0 Foundation, OpenAPI, Genesis, build, migration, and security gates.

## Non-goals

- Authentication or persistent sessions.
- Users, memberships, roles, and permissions.
- Tenant onboarding UI.
- Partner, listing, booking, payment, finance, settlement, or payout modules.
- Replacing RLS with application filtering.
- A generic repository abstraction shared by every domain.
- A universal unit-of-work or session containing every repository.
- Moving untouched Foundation files solely for folder consistency.
- Splitting modules into network services.

## Architecture Decision

Sprint 1A follows `ADR-0007 Hexagonal API Module Boundaries`.

The tenancy module becomes:

```text
apps/api/src/modules/tenancy/
├── domain/
│   ├── tenant-id.ts
│   └── resolved-tenant.ts
├── application/
│   ├── ports/
│   │   ├── tenant-directory.port.ts
│   │   ├── tenant-probe-repository.port.ts
│   │   └── tenant-transaction.port.ts
│   ├── use-cases/
│   │   ├── resolve-tenant.use-case.ts
│   │   └── list-tenant-probes.use-case.ts
│   ├── tenant-context.errors.ts
│   └── tenant-execution-context.ts
├── infrastructure/
│   ├── http/
│   │   ├── tenant-host.ts
│   │   ├── tenant-resolution.middleware.ts
│   │   ├── tenant-required.decorator.ts
│   │   ├── tenant-required.guard.ts
│   │   └── tenant-probe.controller.ts
│   └── persistence/
│       └── prisma/
│           ├── prisma-tenant-directory.adapter.ts
│           ├── prisma-tenant-probe-repository.adapter.ts
│           └── prisma-tenant-transaction.adapter.ts
└── tenancy.module.ts
```

The dependency direction is:

```text
HTTP/Prisma adapters -> application use cases and ports -> domain
NestJS module -> composition and adapter binding
```

### Dependency rules

- `domain/` imports no NestJS, Prisma, HTTP, queue, logger, environment, or infrastructure code.
- `application/` imports only same-module domain, same-module application files, and technology-neutral shared contracts.
- Application ports expose no Prisma, NestJS, Express, Fastify, BullMQ, Redis, or PostgreSQL-specific types.
- Inbound adapters invoke use cases instead of querying persistence.
- Outbound adapters implement application ports.
- One module does not import another module's `infrastructure/` directory.
- Existing files outside the touched tenancy boundary are migrated only when a later slice changes them.

## Trusted Execution Context

Shared request context carries correlation and source metadata:

```ts
export type ExecutionSource =
  | "storefront"
  | "console"
  | "worker"
  | "internal";

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

The base HTTP request-context middleware creates immutable correlation context. Browser-controlled values cannot set `source`, `actorId`, or `tenantId`.

A narrowing function validates tenant context before application execution. Missing, malformed, and nested-conflict cases use dedicated errors rather than database error strings.

## Tenant Resolution Port and Use Case

Tenant identity originates from a trusted hostname resolver. Request body, query string, and arbitrary tenant headers are never authorization sources.

The application owns the outbound port:

```ts
export interface ResolvedTenant {
  readonly id: string;
  readonly slug: string;
}

export interface TenantDirectoryPort {
  findActiveBySlug(slug: string): Promise<ResolvedTenant | null>;
}
```

The application use case owns hostname-to-slug behavior and directory lookup:

```ts
export class ResolveTenantUseCase {
  constructor(private readonly tenants: TenantDirectoryPort) {}

  async execute(hostname: string): Promise<ResolvedTenant | null> {
    const slug = tenantSlugFromHostname(hostname);
    return slug ? this.tenants.findActiveBySlug(slug) : null;
  }
}
```

The HTTP middleware determines effective hostname using configured proxy trust, calls the use case, and enriches immutable context with the resolved tenant ID. It never imports `PrismaService` or a Prisma adapter.

The Prisma directory adapter maps the global `tenants` table to `ResolvedTenant`.

Unknown tenants do not expose database detail. Tenant-required routes return safe 404 when context is absent. Health and readiness remain global and do not execute database-backed tenant middleware.

## Tenant Transaction Port

The application port is technology-neutral and scoped to the capability needed by the current Foundation slice:

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

The application layer does not import Prisma or receive a transaction client. `TenantDataSession` is not a universal repository registry. Later modules add or compose only the capabilities required by a real atomic use case.

The Prisma transaction adapter must:

1. validate the UUID tenant ID before opening a transaction;
2. reject nested execution that changes tenant;
3. reuse the active capability session for same-tenant nested calls;
4. open a Prisma transaction;
5. switch locally to `booking_app`;
6. set transaction-local `app.tenant_id`;
7. construct transaction-bound Prisma implementations of session capabilities;
8. execute the callback with `TenantDataSession`;
9. commit or roll back atomically;
10. prevent capability-session reuse after completion.

Network calls and long-running computation remain outside the database transaction whenever possible.

## Tenant-Probe Vertical Slice

The internal tenant-probe endpoint remains a Foundation proof, but it becomes a complete hexagonal vertical slice:

```text
TenantProbeController
        -> ListTenantProbesUseCase
        -> TenantTransactionPort
        -> TenantDataSession.tenantProbes
        -> PrismaTenantProbeRepositoryAdapter
```

The controller handles authorization and transport mapping. The use case coordinates trusted context and the transaction port. The repository port exposes `list()` without Prisma parameters. The Prisma repository adapter is created inside the transaction adapter with the active transaction client.

This proves the pattern before booking-domain repositories are created.

## Data and Role Classification

### Global control-plane

Examples: `tenants` and future platform-level domain mappings. These are intentionally outside tenant RLS and require explicit application authorization. Access still goes through module-owned ports and adapters.

### Tenant-owned

Examples: `tenant_probes`, tenant-bound `outbox_events`, and future partner, listing, booking, and settlement tables.

Every tenant-owned table requires:

- non-null `tenant_id` unless a documented mixed-scope design explicitly requires otherwise;
- foreign key where applicable;
- tenant index;
- RLS enabled and forced;
- policy with `USING` and `WITH CHECK` tied to `app.tenant_id`;
- least-privilege grants to `booking_app`.

### Privileged infrastructure

Examples: cross-tenant Outbox relay and Inbox processing. Privileged clients and roles are unavailable to ordinary HTTP application code. Their interfaces, injection paths, tests, and logs are separate and auditable.

`worker-critical` may use a worker-only database wrapper that sets `booking_worker`, but it must not export a generic arbitrary-role execution function.

## Architecture Verification

Add a repository script that scans TypeScript imports in declared module roots.

It fails when:

- a `domain/` file imports `@nestjs/*`, `@prisma/client`, delivery/infrastructure code, or prohibited shared infrastructure packages;
- an `application/` file imports Prisma, NestJS delivery code, `infrastructure/`, HTTP framework types, BullMQ, Redis, or PostgreSQL clients;
- an application port includes `Prisma`, `TransactionClient`, `Request`, `Response`, `Job`, or adapter-specific types;
- a module imports another module's `infrastructure/` path;
- a touched or new module is missing from the architecture manifest.

Fixtures include valid and invalid dependency graphs. The verifier runs in CI and `verify:foundation`.

This is an import-direction guard, not a claim that static scanning proves every architecture property. Use-case tests and adapter integration tests provide behavioral coverage.

## Migration Verification

Extend migration verification with a declared tenant-owned table manifest and PostgreSQL catalog inspection. The verifier fails closed when:

- `tenant_id` or its index is missing;
- RLS is not enabled and forced;
- the policy lacks `USING` or `WITH CHECK`;
- policy expressions do not bind to transaction-local `app.tenant_id`;
- `booking_app` is superuser or has `BYPASSRLS`;
- grants exceed approved application privileges;
- a declared tenant-owned table is absent from verification.

Fixtures cover valid and intentionally invalid schema/role combinations.

## Error Handling and Logging

- Missing required context raises a dedicated application/configuration error and returns a safe 500 envelope when it represents incorrect wiring.
- Unknown tenant resolution returns 404 without exposing database details.
- Invalid tenant identifiers fail before transaction creation.
- Nested execution for another tenant raises `TenantContextConflictError`.
- RLS write failures produce safe client responses and structured internal logs.
- Application errors do not include Prisma or PostgreSQL wording in their contract.
- Logs may contain request ID, trace ID, source, operation, tenant ID, worker/event identifiers, and safe failure classification.
- Logs exclude credentials, cookies, authorization values, connection URLs, and sensitive payloads.

## Test Strategy

### Domain and application unit tests

- tenant ID validation;
- hostname-to-slug resolution;
- `ResolveTenantUseCase` with fake `TenantDirectoryPort`;
- `ListTenantProbesUseCase` with fake `TenantTransactionPort` and fake session capability;
- missing, malformed, and nested-conflict context behavior.

These tests import no NestJS or Prisma.

### Adapter tests

- HTTP hostname and proxy trust normalization;
- middleware invokes the use case and enriches context;
- Prisma directory mapping;
- Prisma transaction role and `set_config` order;
- session capability construction;
- Prisma tenant-probe repository mapping.

### Database integration

Cover list, primary-key lookup, raw query, insert, update, update-many, delete, delete-many, upsert, commit, rollback, missing context, invalid context, and attempted cross-tenant mutation.

### Async context

Interleave tenant A and tenant B operations with `Promise.all` and repeated scheduling boundaries to prove AsyncLocalStorage and transaction-local settings never leak.

### HTTP E2E

Cover tenant A, tenant B, unknown host, missing tenant, malicious client-supplied tenant ID, tenant-required routes, proxy trust behavior, and global health/readiness routes.

### Architecture fixtures

Cover valid module dependencies, domain-to-NestJS, domain-to-Prisma, application-to-Prisma, application-to-infrastructure, application port with Prisma type, and cross-module infrastructure import.

### Privileged path

Prove the application role cannot perform cross-tenant relay work, the worker role can perform approved infrastructure work, privileged clients are not exposed to API application code, and logs remain sanitized.

### Migration fixtures

Cover valid policy, missing tenant column, missing tenant index, missing FORCE RLS, missing WITH CHECK, excessive grants, and BYPASSRLS configuration.

## Acceptance Gate

Sprint 1A is complete only when:

1. tenancy domain and application files contain no NestJS or Prisma imports;
2. tenant resolution middleware contains no direct persistence dependency;
3. tenant application callbacks receive `TenantDataSession`, not Prisma transaction types;
4. tenant-probe behavior passes through controller, use case, transaction port, and repository capability;
5. architecture verification fails on every invalid dependency fixture;
6. cross-tenant CRUD and raw-query tests pass;
7. missing, malformed, nested-switch, and concurrent context tests pass;
8. client-supplied tenant IDs cannot override trusted context;
9. migration-policy verification fails closed on every invalid fixture;
10. `booking_app` remains non-superuser and `NOBYPASSRLS`;
11. privileged worker paths are separated, audited, and tested;
12. global health and readiness behavior remains unchanged;
13. Foundation CI, OpenAPI, Genesis, architecture, migration, build, and security gates pass.

## Delivery Boundaries

Implementation is decomposed into reviewable commits covering architecture enforcement, context/domain contracts, tenant-resolution ports and adapters, transaction ports and adapters, tenant-probe vertical slice, isolation tests, migration verification, privileged-path isolation, and documentation.

No identity or booking-domain behavior enters this slice. The Hexagonal pattern applies immediately to tenancy and all new business modules, while untouched Foundation code is migrated only by later slices that need to change it.

## Related Artifacts

- `docs/adr/ADR-0002-modular-monolith-deployment-topology.md`
- `docs/adr/ADR-0003-postgresql-rls-tenant-isolation.md`
- `docs/adr/ADR-0007-hexagonal-api-module-boundaries.md`
- `docs/features/FEATURE-0001-tenant-isolation-core.md`
- `docs/patterns/PATTERN-0001-tenant-scoped-transaction.md`
- `docs/patterns/PATTERN-0002-hexagonal-api-module.md`
