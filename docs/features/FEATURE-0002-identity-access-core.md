---
id: FEATURE-0002
title: Identity Access Core
status: active
owner: identity
date: 2026-08-14
---

# Identity Access Core

## Problem

Booking OS needs one authoritative identity and access kernel for Platform and Tenant administration before later product domains build on top of authentication, membership, and authorization. Parallel identity systems, browser-held bearer tokens, client-selected tenant scope, stale role snapshots, or application-only tenant filtering would create security boundaries that disagree under concurrency.

Sprint 1B closes that gap by making identity global, sessions opaque and host-bound, membership tenant-scoped, authorization server-authoritative, and PostgreSQL FORCE RLS the final tenant boundary.

## Goal

Provide a production-shaped Platform/Tenant identity-access core that can be reused by later Customer and Partner delivery without creating another authentication stack. The core covers provisioning and activation, password reset, opaque sessions, invitation-pending flows, membership lifecycle, fixed system roles, authoritative permission/resource policies, authorization-version reconciliation, security audit, bounded metrics, browser hardening, and acceptance gates `S1B-AC01` through `S1B-AC15`.

## Non-goals

- Customer or Partner registration and full authorization scope; those extend this shared kernel in later delivery.
- Tenant custom-role CRUD or dynamic role-permission mapping; Sprint 2 owns tenant dynamic RBAC.
- Social login, SMS authentication, passkeys, or generalized external identity providers.
- Booking, payment, ledger, settlement, payout, catalog, or availability behavior.
- A generalized cross-tenant administrator bypass around PostgreSQL RLS.
- A full three-level Platform/Tenant/Partner Role Builder UI.

## Business Rules

1. A user identity is global; tenant participation is represented by tenant membership rather than duplicate credentials.
2. Browser sessions use opaque server-side session material. The browser does not keep an API access token.
3. Session material is bound to the trusted exact host and authorization scope. Wrong-host or wrong-scope replay fails closed.
4. Browser session cookies use the host-only `__Host-` contract and state-changing requests require approved Origin plus CSRF proof.
5. Tenant identity comes from the trusted host/session execution context, never from request body, query, or arbitrary client headers.
6. `invitation_pending` is a restricted session subject with an explicit route allowlist and no normal tenant permission authority.
7. Roles are immutable Sprint 1B system roles (`platform_admin`, `tenant_owner`, `tenant_admin`); product controllers request permission keys rather than branching on role names.
8. Every protected request rebuilds or reconciles authority from active user, active membership, role assignments, permission catalog, scope, and authorization-version snapshots before protected logic executes.
9. Permission-only authority changes refresh the snapshot and rotate session material; inactive, suspended, or revoked subjects invalidate affected authority and sessions.
10. `/auth/me/authorization` returns current-scope authority only and is protected from shared/browser caching.
11. Tenant-owned identity-access rows execute under tenant transaction context and PostgreSQL FORCE RLS remains the final isolation boundary.
12. Active tenants retain at least one active owner. Application locking and a commit-time database invariant prevent final-owner removal under concurrency.
13. Account activation, invitation, and password-reset tokens are single-use, short-lived, purpose/subject/host/scope bound, and persisted as selector plus keyed digest rather than raw token material.
14. Refresh-token reuse revokes the affected session family. Explicit session and incident revocation are auditable security-state mutations.
15. Security audit excludes raw credentials, cookies, headers, tokens, envelopes, and email bodies. Metrics use only bounded catalog dimensions and never raw user, tenant, route, or session IDs as labels.
16. Sensitive API and auth browser surfaces use no-store/referrer/frame/content-type protections and request-bound CSP where browser hydration requires a nonce.
17. Security-state mutations couple required audit writes to the same database transaction where atomicity is required.
18. Foundation, architecture, OpenAPI, migration, RLS, identity-access, browser, production-configuration, dependency-audit, and committed-secret gates remain blocking.

## Acceptance Criteria

- Platform bootstrap is serialized and idempotent for the configured initial administrator and emits activation/audit state transactionally.
- Activation, password reset, login, refresh, logout, session listing/revocation, and reset-all-sessions preserve host/scope/security invariants and never expose raw secrets.
- Tenant provisioning and invitation acceptance reuse global identity and are atomic across membership, role, tenant lifecycle, session elevation/rotation, outbox, and audit where specified.
- Host spoofing, wrong-host token/cookie replay, unsafe Origin/CSRF, untrusted authority headers, unsafe redirects, stale authorization versions, and invitation-pending privilege escalation fail closed.
- Owners/admins obey the approved grant matrix, and concurrent operations cannot remove the final active tenant owner.
- Current authorization is authoritative, current-scope-only, no-store, and excludes credential/token/abuse/other-tenant data.
- Tenant identity-access persistence is FORCE-RLS protected and cross-tenant reads/writes fail through the normal application role.
- Security audit rejects sensitive nested metadata and bounded metrics contain no high-cardinality identity labels.
- The named acceptance matrix `S1B-AC01` through `S1B-AC15`, API E2E/RLS tests, and browser acceptance run in protected CI.

## Test Plan

Primary closeout verification:

```bash
pnpm genesis:validate
pnpm check:ci
pnpm verify:architecture
pnpm verify:identity-access
pnpm verify:foundation
pnpm api:check-generated
pnpm build
pnpm test:e2e
```

Canonical design and implementation plans:

- [Identity, Membership, and Authorization Core design](../superpowers/specs/2026-08-05-identity-membership-authorization-core-design.md)
- [Sprint 1B.1 Identity Foundation](../superpowers/plans/2026-08-05-sprint-1b-01-identity-foundation.md)
- [Sprint 1B.2 Session Kernel](../superpowers/plans/2026-08-05-sprint-1b-02-session-kernel.md)
- [Sprint 1B.3 Membership and Tenant Provisioning](../superpowers/plans/2026-08-05-sprint-1b-03-membership-provisioning.md)
- [Sprint 1B.4 Authorization and Security Hardening](../superpowers/plans/2026-08-05-sprint-1b-04-authorization-hardening.md)

Operational procedures live in [`identity-access-recovery.md`](../runbooks/identity-access-recovery.md) and [`platform-admin-bootstrap.md`](../runbooks/platform-admin-bootstrap.md).
