---
id: PATTERN-0001
title: Tenant-Scoped Transaction
status: active
owner: tenancy
date: 2026-08-05
---

# Tenant-Scoped Transaction

## Problem

PostgreSQL RLS depends on a correct transaction-local tenant setting. Passing a tenant ID to individual queries or relying on every developer to remember a `where tenantId` filter is not a sufficient isolation boundary.

Exposing `Prisma.TransactionClient` to application use cases is also unsafe architecturally: it turns persistence technology into an application contract, permits arbitrary table access, and encourages later modules to bypass their repository ports.

## Context

Use this pattern for every API command, query, background job, or application use case that reads or writes tenant-owned tables.

Do not use this pattern for global control-plane tables that are intentionally outside tenant RLS, database migrations, or explicitly classified infrastructure operations that require an audited privileged role. Those paths have separate ports, adapters, and tests and are not available to ordinary HTTP domain code.

Use this together with `PATTERN-0002 Hexagonal API Module`.

## Solution

Represent trusted execution state explicitly:

```ts
interface TenantExecutionContext {
  readonly tenantId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly actorId?: string;
  readonly source: "storefront" | "console" | "worker" | "internal";
}
```

Define transaction and repository capabilities in the application boundary:

```ts
interface TenantProbeRepositoryPort {
  list(): Promise<readonly TenantProbe[]>;
}

interface OutboxWriterPort {
  append(event: AppendOutboxEvent): Promise<void>;
}

interface TenantDataSession {
  readonly tenantProbes: TenantProbeRepositoryPort;
  readonly outbox: OutboxWriterPort;
}

interface TenantTransactionPort {
  run<T>(
    context: TenantExecutionContext,
    work: (session: TenantDataSession) => Promise<T>,
  ): Promise<T>;
}
```

Application orchestration uses only these capabilities:

```ts
return tenantTransactions.run(context, async (session) => {
  return session.tenantProbes.list();
});
```

The Prisma outbound adapter must:

1. validate the tenant identifier before opening a transaction;
2. reject a nested attempt to switch to another tenant;
3. open a Prisma database transaction;
4. set the local database role to `booking_app`;
5. set `app.tenant_id` with transaction-local scope;
6. construct transaction-bound Prisma adapters for the capabilities declared by `TenantDataSession`;
7. execute the callback with the capability session, never with the Prisma transaction;
8. commit on success and roll back on failure;
9. ensure the capability session and underlying transaction are not reused after completion.

Infrastructure owns Prisma details:

```ts
class PrismaTenantProbeRepositoryAdapter
  implements TenantProbeRepositoryPort {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  list(): Promise<readonly TenantProbe[]> {
    return this.transaction.tenantProbe.findMany({
      orderBy: { id: "asc" },
      select: { id: true, tenantId: true, value: true },
    });
  }
}
```

Application and domain files must not import `@prisma/client`, `PrismaService`, or infrastructure adapter classes.

For HTTP requests, resolve tenant identity through an inbound adapter calling a tenant-resolution use case. Ignore or reject client-supplied tenant identifiers that attempt to override resolved context. Global routes declare tenant context optional; tenant-owned routes declare it required.

For workers, reconstruct tenant context from a trusted persisted event or job envelope before calling tenant-owned application code. Cross-tenant infrastructure relay code uses a separate privileged database adapter and never supplies privileged access through `TenantDataSession`.

## Trade-offs

- Application transaction sessions must declare required capabilities explicitly.
- Each capability requires a port and transaction-bound adapter.
- Adding a repository capability changes the session composition in the Prisma transaction adapter.
- Long-running work must be split so network calls do not keep a tenant database transaction open.

These costs keep Prisma outside the application core, make allowed database capabilities visible, preserve deterministic rollback, and ensure RLS protects queries even when adapter code omits a tenant filter.

## Review Checklist

- [ ] Tenant identity comes from a trusted resolver or persisted worker envelope.
- [ ] Client-supplied tenant IDs cannot override trusted context.
- [ ] Tenant ID is validated before the database transaction starts.
- [ ] Application code depends on `TenantTransactionPort`, not its Prisma adapter.
- [ ] The callback receives `TenantDataSession`, not `Prisma.TransactionClient`.
- [ ] Every session capability is an application-owned port.
- [ ] Prisma repository adapters remain under infrastructure persistence.
- [ ] Domain and application files do not import Prisma or NestJS delivery types.
- [ ] The database role is `booking_app` and remains `NOBYPASSRLS`.
- [ ] `app.tenant_id` is transaction-local.
- [ ] Nested execution cannot switch tenants.
- [ ] The capability session does not escape the callback.
- [ ] External network calls do not unnecessarily extend the transaction.
- [ ] Cross-tenant read, write, update, and delete tests exist.
- [ ] Parallel execution proves there is no context leakage.
- [ ] Privileged paths use a separate audited adapter and safe logs.
- [ ] Architecture verification rejects Prisma types in application contracts.
- [ ] Any new tenant-owned table passes migration-policy verification.
