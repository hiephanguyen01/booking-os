---
id: FEATURE-0001
title: Tenant Isolation Core
status: draft
owner: tenancy
date: 2026-08-05
---

# Tenant Isolation Core

## Problem

Sprint 0 proves PostgreSQL Row-Level Security with a tenant probe, but the application boundary is not yet strict enough for production use. Tenant resolution still mixes HTTP and Prisma access, tenant execution context carries only a tenant identifier, and the transaction wrapper exposes Prisma transaction types to application callers. Isolation tests also do not yet cover the full CRUD, concurrency, context-leakage, architecture, and migration-policy matrix.

Without a production-grade boundary, later partner, listing, booking, payment, and settlement modules could accidentally query data outside the current tenant, introduce tenant-owned tables without complete RLS protection, or copy infrastructure-coupled module contracts.

## Goal

Establish a fail-closed tenant execution boundary for HTTP and worker paths using Hexagonal Architecture: application use cases depend on technology-neutral ports, Prisma and NestJS remain in infrastructure adapters, tenant-owned database operations execute under transaction-local PostgreSQL RLS, and automated gates verify both isolation and dependency direction.

## Non-goals

- User authentication and persistent session storage.
- Membership and role-based access control.
- Tenant onboarding user interface.
- Partner, listing, booking, payment, ledger, settlement, or payout behavior.
- Replacing PostgreSQL RLS with application-only filtering.
- Migrating untouched Foundation modules solely to normalize folders.
- Creating generic repositories, a universal unit of work, or ports for domains that do not yet exist.

## Business Rules

1. Tenant identity for an HTTP request must come from a trusted tenant-resolution path, never from a client-supplied tenant ID in the body, query, or arbitrary header.
2. Tenant resolution middleware is an inbound adapter and must invoke an application use case; it must not query Prisma directly.
3. Tenant directory access is defined by an application-owned port and implemented by a Prisma outbound adapter.
4. Tenant-owned database operations must execute through a tenant transaction application port using the `booking_app` database role.
5. The tenant ID must be stored with `set_config('app.tenant_id', value, true)` inside the active database transaction.
6. Application transaction callbacks receive a technology-neutral capability session composed of application ports; they must not receive `Prisma.TransactionClient`.
7. Tenant-owned repository ports are defined in the application boundary. Prisma repository implementations remain in infrastructure persistence adapters and must not expose Prisma types.
8. A missing or invalid tenant context must fail before a tenant-owned operation executes.
9. A nested tenant transaction may reuse the same tenant context but must not switch to another tenant.
10. Domain code must not import NestJS, Prisma, HTTP, queues, loggers, environment configuration, or infrastructure files.
11. Application code must not import Prisma clients, NestJS delivery decorators, middleware, guards, controllers, or infrastructure adapters.
12. One API module must not import another module's persistence adapter or infrastructure directory.
13. Every tenant-owned table must include `tenant_id`, an appropriate tenant index, enabled and forced RLS, a policy with both `USING` and `WITH CHECK`, and least-privilege grants to `booking_app`.
14. The `booking_app` role must remain non-superuser and `NOBYPASSRLS`.
15. Privileged cross-tenant paths must be explicitly classified, unavailable to normal HTTP domain code, and covered by dedicated tests and safe audit logs.
16. Request and worker logs may include request ID, operation, event ID, and tenant ID where appropriate, but must not include credentials, session tokens, connection URLs, or sensitive payloads.
17. Global routes such as health and readiness must continue to work without tenant context.
18. Existing Foundation, OpenAPI, Genesis, migration, architecture, build, and security gates must remain green.

## Acceptance Criteria

- Tenant A cannot read tenant B rows through list, primary-key, raw-query, update, delete, upsert, or bulk operations.
- Tenant A cannot insert or mutate a row whose `tenant_id` belongs to tenant B.
- A request without required tenant context cannot execute a tenant-owned use case.
- A malformed tenant identifier is rejected before a database transaction is opened.
- Concurrent tenant A and tenant B operations do not leak AsyncLocalStorage or transaction-local context between requests.
- A client-supplied tenant ID cannot override the tenant resolved from the trusted request context.
- Tenant resolution middleware contains no Prisma dependency and calls `ResolveTenantUseCase`.
- `ResolveTenantUseCase` is unit-tested with an in-memory `TenantDirectoryPort` fake.
- Tenant application ports and use cases contain no import from `@nestjs/*`, `@prisma/client`, HTTP adapters, or infrastructure paths.
- Tenant transaction callbacks receive `TenantDataSession`, not `Prisma.TransactionClient`.
- Prisma transaction and repository adapters are confined to `infrastructure/persistence/prisma`.
- Architecture verification fails on forbidden domain/application imports and cross-module infrastructure imports.
- A migration-policy verifier fails when a declared tenant-owned table lacks `tenant_id`, a tenant index, FORCE RLS, a complete policy, or safe role configuration.
- Normal HTTP application code cannot use the privileged worker database role.
- The worker privileged path can process valid cross-tenant infrastructure work and emits safe operational logs.
- Foundation CI, OpenAPI contract gates, Genesis validation, architecture verification, migration verification, tests, and builds all pass.

## Test Plan

- Unit tests for hostname normalization, tenant identifier validation, required-context errors, and nested-context rules.
- Application unit tests for tenant resolution and tenant-probe use cases using fake ports without NestJS or Prisma.
- Architecture fixtures for valid imports, domain-to-framework violations, application-to-Prisma violations, application-to-infrastructure violations, and cross-module infrastructure imports.
- Adapter tests for Prisma tenant-directory mapping, transaction capability-session construction, and Prisma repository behavior.
- Database integration tests for read, insert, update, delete, upsert, bulk operations, raw queries, missing context, invalid context, commit, and rollback.
- Parallel execution tests that interleave tenant A and tenant B operations and assert no context leakage.
- HTTP end-to-end tests for tenant A, tenant B, unknown tenant, missing tenant, malicious client-supplied tenant ID, and global health routes.
- Privileged-path tests proving the application role cannot perform cross-tenant relay work while the audited worker role can.
- Migration-verifier fixtures for valid policy, missing tenant column, missing index, missing FORCE RLS, missing WITH CHECK, excessive grants, and BYPASSRLS role configuration.
- Full `pnpm verify:foundation`, architecture, OpenAPI, Genesis, security, and build verification before merge.
