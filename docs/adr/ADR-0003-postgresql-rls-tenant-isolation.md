---
id: ADR-0003
title: PostgreSQL RLS Tenant Isolation
status: accepted
owner: hiephanguyen01
date: 2026-08-04
---

# PostgreSQL RLS Tenant Isolation

## Context

Booking OS is multi-tenant and stores tenant-owned operational and financial data in PostgreSQL. Tenant isolation must remain correct even when application code contains a missing filter or a repository is reused incorrectly.

## Problem

Application-only `tenant_id` filtering creates a single-point failure in every query path. Separate databases per tenant would improve physical isolation but add provisioning and operational complexity that is not justified for the Pilot.

## Options Considered

1. Depend only on application query filters.
2. Use one PostgreSQL schema with `tenant_id` and forced row-level security.
3. Provision a separate schema or database for every tenant.

## Decision

Use shared PostgreSQL tables with mandatory `tenant_id` columns and `FORCE ROW LEVEL SECURITY`. Set tenant context transaction-locally before tenant-scoped work, and expose data through scoped repositories that require an established context.

Bypass roles are limited to audited infrastructure operations such as controlled worker claims or migrations. They may not be used as a convenience for normal application requests.

## Trade-offs

RLS adds policy, migration, and test complexity, and developers must understand transaction-local context. In return, isolation is enforced by the database in addition to application boundaries and remains effective when a query omits an explicit tenant predicate.

## Consequences

New tenant-owned tables require a `tenant_id`, an enabled and forced policy, migration verification, and cross-tenant tests. Code paths that cannot establish tenant context must be classified and reviewed as privileged infrastructure paths.

## Validation

Foundation migrations enable and force RLS, tenant-scoped repositories set transaction-local context, and end-to-end isolation tests prove that two tenants cannot read each other's probe data. Migration verification detects policy drift.

## References

- `docs/superpowers/specs/2026-08-04-booking-os-pilot-design.md`
- `docs/superpowers/plans/2026-08-04-booking-os-pilot-foundation.md`
- `docs/runbooks/foundation-recovery.md`
