---
id: ADR-0007
title: Hexagonal API Module Boundaries
status: accepted
owner: platform-architecture
date: 2026-08-05
---

# Hexagonal API Module Boundaries

## Context

Booking OS uses a modular monolith so business capabilities can share one deployment unit and database while retaining explicit module ownership. Sprint 1A introduces the first persistence and transaction boundary that later partner, catalog, booking, payment, and finance modules will copy.

The Sprint 0 tenancy proof exposes Prisma transaction types directly to application callers and lets HTTP middleware query Prisma. That implementation proves RLS behavior, but if it becomes the default module pattern, application use cases will depend on NestJS and Prisma details and domain modules will be difficult to test or evolve independently.

## Problem

The API needs one enforceable dependency rule that separates business policy from delivery and persistence technology without requiring premature microservices or abstractions for domains that do not yet exist.

The design must preserve explicit tenant transactions and PostgreSQL RLS while preventing these dependencies:

- domain code importing NestJS, Prisma, HTTP, queues, loggers, or environment configuration;
- application code importing Prisma clients, controllers, middleware, guards, or infrastructure adapters;
- inbound adapters querying persistence directly instead of invoking an application use case;
- one module importing another module's persistence adapter;
- repository and transaction ports exposing `Prisma.TransactionClient`.

## Options Considered

1. Continue using NestJS services and Prisma transaction clients as module contracts.
2. Apply ports and adapters only to complex business modules when they arrive.
3. Establish a minimal hexagonal boundary now for touched and new API modules, enforced by architecture tests.

## Decision

Adopt minimal Hexagonal Architecture for `apps/api` modules.

Each business module may contain these dependency zones:

```text
modules/<module>/
├── domain/
├── application/
│   ├── ports/
│   └── use-cases/
├── infrastructure/
│   ├── http/
│   └── persistence/
└── <module>.module.ts
```

The dependency direction is:

```text
infrastructure -> application -> domain
composition root -> every zone in its own module
```

Rules:

1. `domain/` depends only on language/runtime primitives and other domain files in the same module.
2. `application/` depends only on its module's domain and application ports.
3. Application ports describe business-required capabilities and must not expose Prisma, NestJS, HTTP, BullMQ, or PostgreSQL-specific types.
4. Inbound adapters such as controllers, middleware, guards, and queue handlers invoke application use cases.
5. Outbound adapters implement application ports using Prisma, PostgreSQL, external APIs, queues, or other infrastructure.
6. NestJS modules are composition roots that bind tokens to concrete adapters. Decorators and dependency-injection tokens remain outside domain code.
7. A module may consume another module only through an exported application-facing contract, never through its infrastructure directory or database tables.
8. Existing Foundation code is migrated only when a slice touches it. All newly created business-module code must follow these rules immediately.
9. Architecture tests scan module imports and fail CI on forbidden dependency directions.

For tenant-scoped work, a module-specific transaction port exposes only the capabilities required by that slice rather than a Prisma transaction or a universal repository registry:

```ts
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

The Prisma adapter opens the database transaction, sets `booking_app` and transaction-local `app.tenant_id`, constructs transaction-bound repository adapters, and passes only the application-owned session to the callback. Later domains define or compose their own application-facing capabilities when a real atomic use case requires them; Sprint 1A does not create ports for domains that do not yet exist.

## Trade-offs

- More interfaces, tokens, and adapter wiring are required than direct Prisma calls.
- Transaction sessions must list the capabilities needed by the use case.
- Small modules may initially appear more structured than their behavior requires.
- Existing Foundation code will temporarily use mixed organization until touched by a product slice.

In return, business rules remain independent of frameworks, tenant security behavior is centralized in one outbound adapter, module dependencies become reviewable, and later persistence or delivery changes do not rewrite application use cases.

## Consequences

- Sprint 1A must replace the planned Prisma-typed tenant transaction service with an application port and Prisma adapter.
- Tenant host resolution must call a use case backed by a tenant-directory port rather than query Prisma from middleware.
- Tenant probe access becomes a repository port implemented by a transaction-bound Prisma adapter.
- The API receives an architecture verification command that runs in CI.
- Future partner, listing, booking, payment, and finance slices use the same domain/application/infrastructure direction.
- New cross-module access requires an explicit exported application contract or a new accepted ADR.

## Validation

- Architecture fixtures prove forbidden imports fail and valid module imports pass.
- No file under tenancy `domain/` or `application/` imports `@nestjs/*`, `@prisma/client`, HTTP types, BullMQ, or infrastructure paths.
- The tenant resolution middleware has no Prisma dependency.
- Tenant application use cases and ports compile and test with in-memory fakes.
- Prisma and PostgreSQL role logic remain confined to infrastructure persistence adapters.
- Repository-wide CI runs architecture verification together with typecheck, tests, Genesis validation, migration verification, and build.

## References

- `docs/adr/ADR-0002-modular-monolith-deployment-topology.md`
- `docs/adr/ADR-0003-postgresql-rls-tenant-isolation.md`
- `docs/patterns/PATTERN-0002-hexagonal-api-module.md`
- `docs/superpowers/specs/2026-08-05-tenant-isolation-core-design.md`
