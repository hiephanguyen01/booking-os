# Sprint 1A Tenant Isolation Core Design

Date: 2026-08-05
Status: Approved design
Owner: tenancy

## Summary

Sprint 1A converts the Sprint 0 tenant-isolation proof into a production-grade execution boundary. Every tenant-owned operation must run through an explicit transaction-scoped context under the `booking_app` role, PostgreSQL FORCE RLS remains the final enforcement layer, privileged cross-tenant infrastructure paths stay separate, and CI verifies schema, policy, role, and context-isolation invariants.

This slice deliberately excludes authentication, membership, RBAC, onboarding UI, and booking-domain behavior. Those capabilities will build on this boundary in later slices.

## Current State

Sprint 0 already provides:

- host-based tenant resolution;
- AsyncLocalStorage carrying a resolved tenant ID;
- a Prisma transaction wrapper that sets `SET LOCAL ROLE booking_app` and transaction-local `app.tenant_id`;
- FORCE RLS for `tenant_probes` and tenant-bound `outbox_events`;
- a privileged `booking_worker` role for infrastructure relay work;
- isolation tests for cross-tenant reads, inserts, and primary-key lookup.

The remaining risks are incomplete trusted-context metadata, direct root-Prisma access from future tenant repositories, incomplete CRUD and concurrency tests, insufficient privileged-path classification, and migration-policy drift.

## Goals

1. Establish an explicit trusted execution context for HTTP and worker operations.
2. Require tenant-owned repositories to operate only through a scoped transaction client.
3. Prevent tenant switching, missing context, and context leakage.
4. Classify global, tenant-owned, and privileged infrastructure data paths.
5. Fail CI when tenant-owned schema or database-role invariants regress.
6. Preserve all Sprint 0 Foundation, OpenAPI, Genesis, build, migration, and security gates.

## Non-goals

- Authentication or persistent sessions.
- Users, memberships, roles, and permissions.
- Tenant onboarding UI.
- Partner, listing, booking, payment, finance, settlement, or payout modules.
- Replacing RLS with application filtering.
- Unrelated refactoring.

## Chosen Approach

Use an explicit transaction boundary rather than request-long middleware transactions or application-only tenant filters.

```ts
interface TenantExecutionContext {
  readonly tenantId: string;
  readonly requestId: string;
  readonly actorId?: string;
  readonly source: "storefront" | "console" | "worker" | "internal";
}

interface TenantTransaction {
  run<T>(
    context: TenantExecutionContext,
    work: (transaction: TenantTransactionClient) => Promise<T>,
  ): Promise<T>;
}
```

This keeps transaction duration visible, makes repository dependencies explicit, and ensures RLS protects queries even when application code omits a tenant filter.

## Trusted Request Context

Tenant identity must originate from a trusted resolver. Browser-controlled body, query, or arbitrary headers are never authorization sources.

HTTP flow:

1. normalize the effective hostname using configured proxy trust rules;
2. validate the tenant slug or mapped domain;
3. resolve the tenant from the global control-plane table;
4. create immutable request context with request ID, tenant ID, optional actor ID, and source;
5. reject tenant-required routes when resolution fails;
6. allow explicitly global routes such as health and readiness without tenant context.

Unknown tenants return a safe 404. Invalid tenant context fails before opening a database transaction.

## Tenant Transaction Boundary

The boundary must:

1. validate the UUID tenant ID;
2. reject nested execution that changes tenant;
3. open a Prisma transaction;
4. switch locally to `booking_app`;
5. set transaction-local `app.tenant_id`;
6. execute the callback with a scoped client;
7. commit or roll back atomically;
8. prevent transaction-client reuse after completion.

Tenant-owned repositories accept only the scoped client. They must not inject the root `PrismaService` and must not accept an arbitrary tenant ID as their security boundary.

Network calls and long-running computation stay outside the database transaction whenever possible.

## Data and Role Classification

### Global control-plane

Examples: `tenants` and future platform-level domain mappings. These are intentionally outside tenant RLS and require explicit authorization at the application layer.

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

Examples: cross-tenant Outbox relay and Inbox processing. Privileged clients and roles are unavailable to ordinary HTTP domain code. Their interfaces, injection paths, tests, and logs are separate and auditable.

## Migration Verification

Extend migration verification with a declared tenant-owned table manifest and PostgreSQL catalog inspection. The verifier must fail closed when:

- `tenant_id` or its index is missing;
- RLS is not enabled and forced;
- the policy lacks `USING` or `WITH CHECK`;
- policy expressions do not bind to transaction-local `app.tenant_id`;
- `booking_app` is superuser or has `BYPASSRLS`;
- grants exceed the approved application privileges;
- a declared tenant-owned table is absent from verification.

Fixtures cover valid and intentionally invalid schema/role combinations.

## Error Handling and Logging

- Missing required context raises a dedicated programming/configuration error and returns a safe 500 envelope.
- Unknown tenant resolution returns 404 without exposing database details.
- Invalid tenant identifiers fail before transaction creation.
- RLS write failures produce safe client responses and structured internal logs.
- Logs may contain request ID, source, operation, tenant ID, worker/event identifiers, and safe failure classification.
- Logs must exclude credentials, cookies, authorization values, connection URLs, and sensitive payloads.

## Test Strategy

### Database integration

Cover list, primary-key lookup, raw query, insert, update, update-many, delete, delete-many, upsert, commit, rollback, missing context, invalid context, and attempted cross-tenant mutation.

### Async context

Interleave tenant A and tenant B operations with `Promise.all` and repeated scheduling boundaries to prove AsyncLocalStorage and transaction-local settings never leak.

### HTTP E2E

Cover tenant A, tenant B, unknown host, missing tenant, malicious client-supplied tenant ID, tenant-required routes, and global health/readiness routes.

### Repository boundary

Prove tenant-owned repositories cannot use the root Prisma client and require a scoped transaction client.

### Privileged path

Prove the application role cannot perform cross-tenant relay work, the worker role can perform approved infrastructure work, privileged clients are not exposed to domain HTTP services, and logs remain sanitized.

### Migration fixtures

Cover valid policy, missing tenant column, missing tenant index, missing FORCE RLS, missing WITH CHECK, excessive grants, and BYPASSRLS configuration.

## Acceptance Gate

Sprint 1A is complete only when:

1. all tenant-owned repository operations use the scoped transaction boundary;
2. cross-tenant CRUD and raw-query tests pass;
3. missing, malformed, nested-switch, and concurrent context tests pass;
4. client-supplied tenant IDs cannot override trusted context;
5. migration-policy verification fails closed on every invalid fixture;
6. `booking_app` remains non-superuser and `NOBYPASSRLS`;
7. privileged worker paths are separated, audited, and tested;
8. global health and readiness behavior remains unchanged;
9. Foundation CI, OpenAPI, Genesis, migration, build, and security gates pass.

## Delivery Boundaries

Implementation should be decomposed into reviewable commits covering context contracts, transaction behavior, repository boundaries, migration verification, isolation tests, privileged-path tests, and documentation. No identity or booking-domain behavior enters this slice.

## Related Artifacts

- `docs/adr/ADR-0003-postgresql-rls-tenant-isolation.md`
- `docs/features/FEATURE-0001-tenant-isolation-core.md`
- `docs/patterns/PATTERN-0001-tenant-scoped-transaction.md`
