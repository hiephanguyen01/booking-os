---
id: PATTERN-0002
title: Hexagonal API Module
status: active
owner: platform-architecture
date: 2026-08-05
---

# Hexagonal API Module

## Problem

Direct imports from controllers or application services into Prisma repositories make delivery, orchestration, and persistence concerns indistinguishable. This weakens module ownership, makes unit tests depend on infrastructure, and allows database technology to become part of business-facing contracts.

## Context

Apply this pattern to every new business module in `apps/api` and to existing modules when a delivery slice materially changes them. Sprint 1A applies it to tenancy because tenant resolution and transaction handling will be reused by every later tenant-owned module.

Do not perform repository-wide file moves solely for visual consistency. Foundation code that is not touched by a slice may remain in its current location until an actual business change requires the boundary.

## Solution

Organize a module by dependency direction:

```text
apps/api/src/modules/<module>/
├── domain/
├── application/
│   ├── ports/
│   └── use-cases/
├── infrastructure/
│   ├── http/
│   └── persistence/
└── <module>.module.ts
```

### Domain

Domain files contain entities, value objects, policies, and domain errors. They do not import NestJS, Prisma, HTTP, environment configuration, loggers, queue libraries, or infrastructure files.

### Application

Application use cases coordinate domain behavior through ports owned by the module. Ports describe capabilities in business terms.

```ts
export interface TenantDirectoryPort {
  findActiveBySlug(slug: string): Promise<ResolvedTenant | null>;
}

export interface ResolveTenantInput {
  readonly hostname: string;
}

export class ResolveTenantUseCase {
  constructor(private readonly tenants: TenantDirectoryPort) {}

  execute(input: ResolveTenantInput): Promise<ResolvedTenant | null> {
    const slug = tenantSlugFromHostname(input.hostname);
    return slug ? this.tenants.findActiveBySlug(slug) : Promise.resolve(null);
  }
}
```

Application code does not import framework decorators, Prisma models, transport requests, or infrastructure adapters.

### Inbound adapters

Controllers, middleware, guards, and queue handlers translate an external request into an application input and map an application result back to the delivery mechanism.

```ts
const tenant = await this.resolveTenant.execute({ hostname });
```

Inbound adapters do not query Prisma or another module's persistence adapter directly.

### Outbound adapters

Persistence and integration adapters implement application ports.

```ts
@Injectable()
export class PrismaTenantDirectoryAdapter implements TenantDirectoryPort {
  constructor(private readonly prisma: PrismaService) {}

  findActiveBySlug(slug: string): Promise<ResolvedTenant | null> {
    return this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    });
  }
}
```

Framework decorators are allowed here because this is infrastructure code.

### Transaction capability sessions

Application callbacks do not receive `Prisma.TransactionClient`. The transaction port supplies a capability session composed of application-owned ports:

```ts
export interface TenantDataSession {
  readonly tenantProbes: TenantProbeRepositoryPort;
  readonly outbox: OutboxWriterPort;
}

export interface TenantTransactionPort {
  run<T>(
    context: TenantExecutionContext,
    work: (session: TenantDataSession) => Promise<T>,
  ): Promise<T>;
}
```

The Prisma transaction adapter creates transaction-bound implementations behind this session.

### Composition root

The NestJS module owns dependency injection tokens and binds application ports to adapters. Tokens are symbols exported from the application boundary or module composition file; domain code never imports them.

### Cross-module access

A module may import another module's exported application contract. It must not import another module's `infrastructure/` directory, Prisma adapter, controller, or table-specific repository.

## Trade-offs

- More small files and explicit interfaces.
- Dependency-injection wiring is more verbose.
- Transaction sessions require deliberate capability design.
- Some Foundation code will temporarily follow older organization until touched.

The benefit is stable business-facing contracts, fast unit tests, auditable dependency direction, and freedom to replace infrastructure without changing use cases.

## Review Checklist

- [ ] Domain files import only same-module domain code and runtime primitives.
- [ ] Application files import only same-module domain, application ports, and shared technology-neutral contracts.
- [ ] Application ports contain no Prisma, NestJS, HTTP, BullMQ, Redis, or PostgreSQL types.
- [ ] Controllers, middleware, guards, and consumers invoke use cases instead of querying persistence.
- [ ] Prisma access exists only in infrastructure persistence adapters or database foundation code.
- [ ] The NestJS module acts as composition root and binds ports to adapters.
- [ ] Tenant transaction callbacks receive capability ports, not a Prisma transaction client.
- [ ] No module imports another module's infrastructure directory.
- [ ] Unit tests use fakes for application ports.
- [ ] Adapter integration tests verify Prisma mappings and transaction behavior.
- [ ] Architecture verification covers all new or touched module files.
- [ ] Any exception is documented by an accepted ADR rather than a local shortcut.
