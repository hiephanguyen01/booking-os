---
id: PATTERN-0004
title: Tenant Dynamic RBAC Authority
status: active
owner: authorization
date: 2026-08-20
---

# Tenant Dynamic RBAC Authority

## Problem

Dynamic roles are mutable authority. If role names become authorization facts, if custom-role reads bypass tenant transactions, or if permission/assignment mutations do not invalidate stale authority atomically, a tenant-local convenience feature can become a cross-tenant or stale-privilege security defect.

## Context

Use this pattern for tenant custom-role metadata, custom-role permission mappings, membership custom-role assignments, and effective-permission loading in the Platform/Tenant authorization kernel. It extends the fixed Sprint 1B system-role model; it does not replace trusted host/session scope, Permission Catalog V2, authorization-version reconciliation, or PostgreSQL FORCE RLS.

Canonical references:

- [Sprint 2 Tenant Dynamic RBAC design](../superpowers/specs/2026-08-16-sprint-2-tenant-dynamic-rbac-design.md)
- [Sprint 2 Tenant Dynamic RBAC implementation plan](../superpowers/plans/2026-08-16-sprint-2-tenant-dynamic-rbac.md)

## Solution

Keep identity, scope, role identity, permission authority, persistence, and invalidation separate:

1. Resolve tenant scope only from trusted host/session authorization context.
2. Keep the permission catalog code-owned; persist only tenant custom-role metadata, permission-key mappings, and membership assignments.
3. Execute all tenant custom-RBAC persistence through the tenant transaction/data-session boundary and normal application role so FORCE RLS is always active.
4. Treat system role assignments as the sole source of `AuthorizationContext.roleKeys`. Union active custom-role permission contributions into effective `permissionKeys` only.
5. Require owner governance for mutations in addition to route permission checks. A permission key alone must not bypass owner policy.
6. Validate desired permission additions before writing; reject the full mutation when any added key is unknown, platform-only, non-delegable, or not held by the actor.
7. Use optimistic role versions for metadata/permission changes and stable database lock ordering for role/membership assignment races.
8. On a real authority change, increment affected membership authorization version in the same transaction as the RBAC mutation and required security audit event.
9. Reconcile session/authorization version before protected application logic so stale custom authority fails closed.
10. Map inaccessible tenant resources to stable safe errors without exposing SQL, Prisma, or foreign-resource existence.

## Trade-offs

- Strong transaction and locking rules add database work to authority mutations, but keep reads and authorization deterministic under concurrency.
- Custom roles cannot act as public role identities; callers that need policy decisions use permission keys rather than custom role names.
- Permission Catalog changes require code delivery instead of tenant database mutation, preserving an auditable closed capability vocabulary.
- Archive is intentionally safer than destructive deletion because assignment/audit history remains available while effective authority is removed.
- Operational rollback favors a forward fix or schema-compatible application rollback; RBAC history is not deleted to undo an incident.

## Review Checklist

- [ ] Tenant scope comes from trusted server context; no DTO/query/header supplies tenant authority.
- [ ] Persistence executes inside the tenant transaction and FORCE RLS boundary.
- [ ] Custom roles do not enter system `roleKeys`.
- [ ] Added permissions are catalog-known, tenant-delegable, and held by the actor.
- [ ] Owner governance is enforced for mutation use cases.
- [ ] Version conflicts and duplicate grant/revoke races fail or converge deterministically.
- [ ] Real authority changes invalidate membership authorization version atomically.
- [ ] Archive removes effective authority and cannot race into a surviving active assignment.
- [ ] Required audit data is transactional, bounded, and free of raw secret material.
- [ ] HTTP errors remain stable and existence-safe for foreign/inaccessible identifiers.
- [ ] `pnpm verify:dynamic-rbac` and Sprint 1B regression gates remain green.
