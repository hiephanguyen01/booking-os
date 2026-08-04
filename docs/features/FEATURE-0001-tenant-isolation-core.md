---
id: FEATURE-0001
title: Tenant Isolation Core
status: active
owner: tenancy
date: 2026-08-05
---

# Tenant Isolation Core

## Problem

Sprint 0 proves PostgreSQL Row-Level Security with a tenant probe, but the application boundary is not yet strict enough for production use. Tenant resolution still depends on request host handling, tenant execution context carries only a tenant identifier, tenant-owned repositories can still be written against the root Prisma client, and the isolation tests do not yet cover the full CRUD, concurrency, context-leakage, and migration-policy matrix.

Without a production-grade boundary, later partner, listing, booking, payment, and settlement modules could accidentally query data outside the current tenant or introduce tenant-owned tables without complete RLS protection.

## Goal

Establish a fail-closed tenant execution boundary for HTTP and worker paths so every tenant-owned database operation runs in an explicit transaction-local tenant context enforced by PostgreSQL FORCE RLS and verified by automated tests and migration checks.

## Non-goals

- User authentication and persistent session storage.
- Membership and role-based access control.
- Tenant onboarding user interface.
- Partner, listing, booking, payment, ledger, settlement, or payout behavior.
- Replacing PostgreSQL RLS with application-only filtering.
- General refactoring outside the tenancy, database-role, migration-verification, and isolation-test boundaries required by this feature.

## Business Rules

1. Tenant identity for an HTTP request must come from a trusted tenant-resolution path, never from a client-supplied tenant ID in the body, query, or arbitrary header.
2. Tenant-owned database operations must execute through the tenant transaction boundary using the `booking_app` database role.
3. The tenant ID must be stored with `set_config('app.tenant_id', value, true)` inside the active database transaction.
4. Tenant-owned repositories must receive a transaction-scoped client and must not query through the root Prisma client.
5. A missing or invalid tenant context must fail before a tenant-owned repository operation executes.
6. A nested tenant transaction may reuse the same tenant context but must not switch to another tenant.
7. Every tenant-owned table must include `tenant_id`, an appropriate tenant index, enabled and forced RLS, a policy with both `USING` and `WITH CHECK`, and least-privilege grants to `booking_app`.
8. The `booking_app` role must remain non-superuser and `NOBYPASSRLS`.
9. Privileged cross-tenant paths must be explicitly classified, unavailable to normal HTTP domain code, and covered by dedicated tests and safe audit logs.
10. Request and worker logs may include request ID, operation, event ID, and tenant ID where appropriate, but must not include credentials, session tokens, connection URLs, or sensitive payloads.
11. Global routes such as health and readiness must continue to work without tenant context.
12. Existing Foundation, OpenAPI, Genesis, migration, build, and security gates must remain green.

## Acceptance Criteria

- Tenant A cannot read tenant B rows through list, primary-key, raw-query, update, delete, upsert, or bulk operations.
- Tenant A cannot insert or mutate a row whose `tenant_id` belongs to tenant B.
- A request without required tenant context cannot execute tenant-owned repository code.
- A malformed tenant identifier is rejected before a database transaction is opened.
- Concurrent tenant A and tenant B operations do not leak AsyncLocalStorage or transaction-local context between requests.
- A client-supplied tenant ID cannot override the tenant resolved from the trusted request context.
- Tenant-owned repositories use a transaction-scoped client rather than the root Prisma client.
- A migration-policy verifier fails when a declared tenant-owned table lacks `tenant_id`, a tenant index, FORCE RLS, a complete policy, or safe role configuration.
- Normal HTTP application code cannot use the privileged worker database role.
- The worker privileged path can process valid cross-tenant infrastructure work and emits safe operational logs.
- Foundation CI, OpenAPI contract gates, Genesis validation, migration verification, tests, and builds all pass.

## Test Plan

- Unit tests for hostname normalization, tenant identifier validation, required-context errors, and nested-context rules.
- Database integration tests for read, insert, update, delete, upsert, bulk operations, raw queries, missing context, invalid context, commit, and rollback.
- Parallel execution tests that interleave tenant A and tenant B operations and assert no context leakage.
- HTTP end-to-end tests for tenant A, tenant B, unknown tenant, missing tenant, malicious client-supplied tenant ID, and global health routes.
- Repository-boundary tests that prevent tenant-owned repositories from using the root Prisma client.
- Privileged-path tests proving the application role cannot perform cross-tenant relay work while the audited worker role can.
- Migration-verifier fixtures for valid policy, missing tenant column, missing index, missing FORCE RLS, missing WITH CHECK, excessive grants, and BYPASSRLS role configuration.
- Full `pnpm verify:foundation`, OpenAPI, Genesis, security, and build verification before merge.
