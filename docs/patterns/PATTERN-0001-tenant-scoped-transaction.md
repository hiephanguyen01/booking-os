---
id: PATTERN-0001
title: Tenant-Scoped Transaction
status: active
owner: tenancy
date: 2026-08-05
---

# Tenant-Scoped Transaction

## Problem

PostgreSQL RLS depends on a correct transaction-local tenant setting. Passing a tenant ID to individual queries or relying on every developer to remember a `where tenantId` filter is not a sufficient isolation boundary. Tenant-owned repositories also become unsafe when they can access the root Prisma client directly because they may execute without the application database role or tenant context.

## Context

Use this pattern for every API command, query, background job, or domain service that reads or writes tenant-owned tables.

Do not use this pattern for global control-plane tables that are intentionally outside tenant RLS, database migrations, or explicitly classified infrastructure operations that require an audited privileged role. Those paths must have separate interfaces and tests and must not be available to ordinary HTTP domain code.

## Solution

Represent trusted execution state explicitly:

```ts
interface TenantExecutionContext {
  readonly tenantId: string;
  readonly requestId: string;
  readonly actorId?: string;
  readonly source: "storefront" | "console" | "worker" | "internal";
}
```

Expose one tenant transaction boundary:

```ts
interface TenantTransaction {
  run<T>(
    context: TenantExecutionContext,
    work: (transaction: TenantTransactionClient) => Promise<T>,
  ): Promise<T>;
}
```

The implementation must:

1. validate the tenant identifier before opening a transaction;
2. reject a nested attempt to switch to another tenant;
3. open a Prisma database transaction;
4. set the local database role to `booking_app`;
5. set `app.tenant_id` with transaction-local scope;
6. execute the callback with a transaction-scoped client;
7. commit on success and roll back on failure;
8. ensure the transaction client and tenant context cannot be reused after the callback completes.

Tenant-owned repositories accept the scoped transaction client:

```ts
class BookingRepository {
  create(
    transaction: TenantTransactionClient,
    input: CreateBookingInput,
  ) {
    return transaction.booking.create({ data: input });
  }
}
```

Application orchestration supplies trusted context:

```ts
return tenantTransaction.run(context, async (transaction) => {
  return bookingRepository.create(transaction, input);
});
```

The repository must not accept an arbitrary tenant ID as its authorization boundary and must not inject or retain the root Prisma client.

For HTTP requests, resolve tenant identity from the trusted hostname/domain path. Ignore or reject client-supplied tenant identifiers that attempt to override the resolved context. Global routes declare that tenant context is optional; tenant-owned routes declare it is required.

For workers, reconstruct tenant context from a trusted persisted event or job envelope before calling tenant-owned domain code. Cross-tenant infrastructure relay code uses a separate privileged client and interface and never calls tenant-owned repositories through that client.

## Trade-offs

- Database operations require explicit transaction plumbing through services and repositories.
- Long-running work must be split so network calls do not keep a tenant database transaction open.
- Global and privileged paths require deliberate classification instead of sharing one universal database client.
- Unit tests need transaction-client fakes or focused integration coverage.

These costs provide a visible security boundary, deterministic rollback, consistent RLS behavior, and protection when an application query omits a tenant filter.

## Review Checklist

- [ ] Tenant identity comes from a trusted resolver or persisted worker envelope.
- [ ] Client-supplied tenant IDs cannot override trusted context.
- [ ] Tenant ID is validated before the database transaction starts.
- [ ] The operation runs through the tenant transaction boundary.
- [ ] The database role is `booking_app` and remains `NOBYPASSRLS`.
- [ ] `app.tenant_id` is transaction-local.
- [ ] Tenant-owned repositories receive a transaction-scoped client.
- [ ] Tenant-owned repositories do not inject the root Prisma client.
- [ ] Nested execution cannot switch tenants.
- [ ] The transaction client does not escape the callback.
- [ ] External network calls do not unnecessarily extend the transaction.
- [ ] Cross-tenant read, write, update, and delete tests exist.
- [ ] Parallel execution proves there is no context leakage.
- [ ] Privileged paths use a separate audited interface and safe logs.
- [ ] Any new tenant-owned table passes migration-policy verification.
