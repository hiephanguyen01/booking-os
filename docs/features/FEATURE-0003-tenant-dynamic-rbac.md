---
id: FEATURE-0003
title: Tenant Dynamic RBAC
status: active
owner: authorization
date: 2026-08-20
---

# Tenant Dynamic RBAC

## Problem

Sprint 1B intentionally shipped fixed, immutable system roles. Tenant operators still need a safe way to group delegable tenant permissions into tenant-owned roles without turning role names into authority, allowing cross-tenant references, or weakening the server-authoritative session and PostgreSQL RLS boundaries.

## Goal

Provide tenant-scoped dynamic RBAC on top of Permission Catalog V2. Tenant owners can create and maintain custom roles, replace permission sets, archive roles, and grant or revoke those roles for active same-tenant memberships. Effective authorization remains permission-based and current-scope-only, while custom-role changes invalidate stale membership authority and remain auditable, tenant isolated, and concurrency safe.

## Non-goals

- Platform custom roles, Partner custom roles, or cross-tenant role sharing.
- A full Platform/Tenant/Partner Role Builder UI.
- Client-supplied tenant authority or custom-role identifiers in `AuthorizationContext.roleKeys`.
- Mutable system roles or a database-owned permission catalog.
- A privileged operator endpoint that bypasses tenant authorization, RLS, CSRF, or owner governance.

## Business Rules

1. Permission Catalog V2 remains code-owned and append-only; tenant roles only reference known tenant-delegable permission keys.
2. System roles remain immutable and distinct from tenant custom roles. Custom roles contribute permissions, never system `roleKeys`.
3. Tenant identity is derived from trusted host/session context; Tenant RBAC DTOs never accept `tenantId` as authority.
4. Custom-role rows, permission mappings, and assignments are tenant-owned, same-tenant constrained, and protected by PostgreSQL FORCE RLS through the normal application role.
5. Tenant owners govern RBAC mutations. Tenant admins may receive approved read authority but cannot mutate dynamic RBAC by default, even if a mutation permission is artificially present.
6. Normalized custom-role names are unique within the tenant boundary and do not create cross-tenant conflicts.
7. Permission replacement uses optimistic `expectedVersion`. Changed sets advance role version once and invalidate affected active membership authorization versions; identical desired sets are no-op.
8. Unknown, platform-only, non-delegable, or actor-not-held permission additions fail atomically. Authorized removal remains permitted.
9. Assignment grant/revoke uses stable role-to-membership lock ordering. Duplicate concurrent grants or revokes converge to one real authority change, one authorization-version increment, and one corresponding audit event.
10. Archiving a custom role revokes its active assignments and removes its effective permission contribution. Archive-versus-replace and archive-versus-grant races are serialized so archived authority cannot remain active.
11. Every protected request reconciles authoritative membership/session state before application logic. A stale authorization context cannot continue using revoked custom-role permission authority.
12. Authority-changing RBAC mutations and required audit writes share the same transaction boundary; audit and metrics remain bounded and secret-safe.
13. Normative HTTP mutations preserve the existing exact-host/session, Origin, CSRF, permission-guard, stable error-code, and private no-store conventions.
14. Foreign or inaccessible role/membership identifiers use fail-closed not-found/denied semantics without existence leakage.

## Acceptance Criteria

- `S2-RBAC01` through `S2-RBAC16` resolve to executable evidence through `pnpm verify:dynamic-rbac`.
- Owner create/read, normalized-name tenant isolation, admin read-only behavior, and system-role immutability are covered.
- Invalid/non-delegable/actor-not-held permission additions reject atomically.
- Permission replacement, stale-version rejection, archive effects, assignment grant/revoke, and required concurrency races are covered against PostgreSQL.
- FORCE RLS and missing tenant context fail closed for custom-RBAC persistence.
- Effective tenant permissions include only active same-tenant custom-role authority, remain sorted/de-duplicated, and never widen system `roleKeys`.
- Stale session/authorization authority is reconciled before protected use-case execution.
- Security audit is transactional, bounded, and secret-safe.
- Sprint 1B identity access and protected repository gates remain blocking regressions for Sprint 2.

## Test Plan

Primary acceptance command:

```bash
pnpm verify:dynamic-rbac
```

Closeout verification also keeps the existing protected gates blocking:

```bash
pnpm genesis:validate
pnpm verify:delivery-reconciliation
pnpm check:ci
pnpm verify:architecture
pnpm verify:migrations
pnpm verify:identity-access
pnpm verify:foundation
```

Canonical design and implementation plan:

- [Sprint 2 Tenant Dynamic RBAC design](../superpowers/specs/2026-08-16-sprint-2-tenant-dynamic-rbac-design.md)
- [Sprint 2 Tenant Dynamic RBAC implementation plan](../superpowers/plans/2026-08-16-sprint-2-tenant-dynamic-rbac.md)

Operational recovery procedures live in [`tenant-dynamic-rbac-recovery.md`](../runbooks/tenant-dynamic-rbac-recovery.md).
