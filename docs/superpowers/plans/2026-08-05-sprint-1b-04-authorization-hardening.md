# Sprint 1B.4 Authorization and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make backend authorization authoritative on every protected request, reconcile authorization versions, expose `/auth/me/authorization`, harden browser/cache/logging behavior, and close Sprint 1B with full acceptance gates.

**Architecture:** `AuthorizationModule` builds immutable authority from validated session, active user, active membership, system roles/permissions, and target scope. Permission guards consume application ports; grant/resource policies remain pure. Tenant operations still execute through the Sprint 1A RLS transaction so PostgreSQL remains the final boundary.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11.1, Prisma 6.19, PostgreSQL 17 FORCE RLS, Redis 7, OpenAPI 3.1, Node test runner, Supertest, Playwright, pnpm 10, GitHub Actions.

## Global Constraints

- Begin after Plans 1–3 review on `feat/sprint-1b-04-authorization-hardening` from the accepted Plan 3 head.
- Follow red-green-refactor and keep every commit buildable.
- Allow requires authenticated + scope match + active user + active tenant membership + permission + resource/grant policy + tenant RLS.
- `invitation_pending` never satisfies normal permission guards.
- Controllers/use cases request permission keys; no product controller role-name branches.
- Every protected request compares user and membership authorization versions with session snapshots.
- Version mismatch rebuilds authority. Disabled/suspended/revoked subject revokes session; permission-only change refreshes snapshot and rotates token.
- Tenant identity remains exact-host derived; body/query/arbitrary headers never establish authorization tenant.
- `/auth/me/authorization` returns current scope only and excludes credential/token/abuse/other-tenant data.
- Auth responses are private/no-store; no shared caching.
- Audit/metrics/logs exclude raw email, passwords, cookies, headers, tokens, envelopes, email bodies, and high-cardinality IDs as labels.
- Auth pages receive restrictive CSP, `Referrer-Policy: no-referrer`, frame denial, and no-store before third-party code.
- Preserve Foundation, architecture, migration, OpenAPI compatibility, production guard, dependency audit, secret scan, unit/integration/API/browser gates.

---

### Task 1: Authorization Context and Version Reconciliation

**Files:**
- Create authorization domain/errors
- Create ports: `authorization-repository.port.ts`, `session-authorization-refresh.port.ts`
- Create/test use cases: `build-authorization-context`, `reconcile-authorization-version`
- Create/test Prisma authorization repository
- Create tokens/module; modify AppModule and architecture manifest.

**Produces:**
```ts
interface AuthorizationContext {
  userId: string;
  sessionId: string;
  scope: { type: "platform" } | { type: "tenant"; tenantId: string; tenantSlug: string };
  membershipId?: string;
  membershipStatus?: "active";
  roleKeys: readonly SystemRole[];
  permissionKeys: readonly PermissionKey[];
  userAuthorizationVersion: number;
  membershipAuthorizationVersion?: number;
}
```

- [ ] Write tests for platform/tenant context, inactive user/membership, unknown role, permission dedupe, pending-session rejection, current-scope-only data, no mismatch, permission-only refresh+rotation, and revocation on inactive subject.
- [ ] Run `pnpm --filter @booking-os/api test -- build-authorization-context.use-case.test.ts reconcile-authorization-version.use-case.test.ts prisma-authorization-repository.adapter.test.ts`; expected FAIL.
- [ ] Implement use cases/adapters; tenant authority loads only inside tenant transaction.
- [ ] Rerun focused tests/typecheck/architecture; expected PASS.
- [ ] Commit: `feat: build authoritative authorization context`.

### Task 2: Permission Guards and Resource Policies

**Files:**
- Create `requires-permission.decorator.ts`, `permission.guard.ts`/test, `authorization-context.decorator.ts`
- Create/test `tenant-session-revocation.policy.ts`, `membership-target.policy.ts`
- Modify protected membership/session/platform controllers.

**Usage:**
```ts
@RequiresPermission("tenant.membership.admin.invite")
@Post("membership/invitations")
inviteAdmin() {}
```

- [ ] Write guard tests for no session, pending session, wrong scope, missing membership/permission, version mismatch, allowed path, and denial before controller invocation. Write policy matrices for admin-versus-owner sessions/memberships and final owner.
- [ ] Run `pnpm --filter @booking-os/api test -- permission.guard.test.ts tenant-session-revocation.policy.test.ts membership-target.policy.test.ts`; expected FAIL.
- [ ] Implement guard and pure policies; apply one declared permission plus resource policy to every Sprint 1B protected route.
- [ ] Rerun unit and affected E2E/architecture; expected PASS.
- [ ] Commit: `feat: enforce permission and resource policies`.

### Task 3: Bind Authorization to Trusted Request and Tenant Execution Context

**Files:**
- Modify request-context contracts/tests/storage/types
- Modify tenant execution context/test and Prisma tenant transaction adapter/test
- Create `authorization-before-use-case.e2e.test.ts`, `authorization-context-concurrency.e2e.test.ts`

**Produces:**
```ts
interface AuthorizedTenantExecutionContext extends TenantExecutionContext {
  actorId: string;
  sessionId: string;
  authorization: AuthorizationContext;
}
```

- [ ] Write tests proving `x-user-id`, `x-session-id`, `x-role`, `x-permission`, and version headers cannot populate context; nested context cannot switch actor/session/tenant. Prove denial occurs before use-case/repository invocation and concurrent version changes cannot commit stale authority.
- [ ] Run `pnpm --filter @booking-os/api test:e2e -- authorization-before-use-case.e2e.test.ts authorization-context-concurrency.e2e.test.ts`; expected FAIL.
- [ ] Build authorization once after session validation and before tenant transaction; pass immutable context.
- [ ] Rerun contracts/API E2E/architecture; expected PASS.
- [ ] Commit: `feat: bind authorization to tenant execution`.

### Task 4: Authorization Endpoint and Admin Session Revocation

**Files:**
- Create/test `get-current-authorization.use-case.ts`, authorization controller/DTO
- Create/test `admin-revoke-user-sessions.use-case.ts`
- Create `authorization-endpoint.e2e.test.ts`, `admin-session-revocation.e2e.test.ts`

**Routes:** `GET /auth/me/authorization`, `POST /platform/security/users/:userId/sessions/revoke`.

- [ ] Write contract tests requiring current user/session/scope/tenant/membership/roles/permissions/versions, excluding other memberships/password/hash/token/abuse fields. Require `Cache-Control: private, no-store`, `Vary: Cookie, Origin`, no ETag/shared cache, JSON UTF-8.
- [ ] Run `pnpm --filter @booking-os/api test -- get-current-authorization.use-case.test.ts authorization.controller.test.ts admin-revoke-user-sessions.use-case.test.ts`; expected FAIL.
- [ ] Implement endpoint and explicit platform incident revocation with exact host, permission, CSRF, audit reason, target user.
- [ ] Run unit/E2E, OpenAPI generation/check/breaking check; expected PASS.
- [ ] Commit: `feat: expose authoritative authorization context`.

### Task 5: Browser, Cache, Redirect, Logging, and Outbox Hardening

**Files:**
- Create/test auth security headers interceptor
- Modify API main, HTTP logging interceptor/tests
- Modify observability logger/tests
- Modify worker outbox dispatcher/tests
- Modify web middleware/Next config
- Create/test `apps/web-console/src/lib/security/return-url.ts`
- Create `auth-security-regression.e2e.test.ts`

**Required headers:** `Content-Security-Policy: default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.

- [ ] Write tests for activation/reset/invite/login/me/authorization headers, external/protocol-relative/encoded return URL rejection, and recursive redaction of password/cookie/header/token/envelope fields from logs/traces/dead letters/errors.
- [ ] Run `pnpm --filter @booking-os/api test:e2e -- auth-security-regression.e2e.test.ts`; expected FAIL.
- [ ] Implement route-aware headers, bounded recursive redaction, no auth request-body logging, and same-origin redirect allowlist.
- [ ] Rerun API/observability/worker/web tests; expected PASS.
- [ ] Commit: `fix: harden identity access boundaries`.

### Task 6: Transactional Audit and Bounded Metrics

**Files:**
- Create/test security-audit port and Prisma adapter
- Create/test auth-metrics adapter
- Modify identity/session/membership use cases to emit approved events
- Create `security-audit.e2e.test.ts`

**Event catalog:** user provisioned/activated/password change-reset; session created/rotated/revoked/reuse; membership invited/resent/accepted/suspended/revoked/owner promoted-demoted; tenant provisioned/activated; bootstrap admin; authorization denied.

- [ ] Write tests requiring action/result/reason/request/hostname/actor/target/tenant where known and rejecting sensitive fields. Metric labels are limited to purpose/outcome/scope/reason family/delay bucket/event type.
- [ ] Run `pnpm --filter @booking-os/api test -- prisma-security-audit.adapter.test.ts auth-metrics.adapter.test.ts`; expected FAIL.
- [ ] Implement transactionally coupled audit for security-state mutations; emit noncritical bounded metrics after commit.
- [ ] Rerun unit and audit E2E; expected PASS.
- [ ] Commit: `feat: audit identity access events`.

### Task 7: Acceptance, Security, RLS, Concurrency, and CI Matrix

**Files:**
- Create `identity-access-security-matrix.e2e.test.ts`, `identity-access-rls-matrix.e2e.test.ts`, `identity-access-concurrency.e2e.test.ts`
- Create `e2e/identity-access.spec.ts`
- Modify CI workflows and root package scripts.

- [ ] Encode approved acceptance criteria as named `S1B-AC01` through `S1B-AC15` tests. Add Host spoofing, wrong-host token/cookie, CSRF/origin, password/enumeration, raw-secret, rotation/reuse, grant/final-owner, reset-all-sessions, no-store, redirect, pending allowlist, and all concurrency races.
- [ ] Run the new focused matrix; expected FAIL until missing enforcement/gates are completed.
- [ ] Add `verify:identity-access` and named CI job after architecture and before build; preserve Foundation gates.
- [ ] Run `pnpm verify:identity-access`, `pnpm verify:foundation`, OpenAPI compatibility/breaking; expected PASS.
- [ ] Commit: `test: verify Sprint 1B identity access`.

### Task 8: Feature, Runbook, Rollout, and Closeout Documentation

**Files:**
- Create `docs/features/FEATURE-0002-identity-access-core.md`
- Create `docs/patterns/PATTERN-0003-host-bound-opaque-session.md`
- Create `docs/runbooks/identity-access-recovery.md`, `platform-admin-bootstrap.md`
- Create `docs/superpowers/checkpoints/2026-08-05-sprint-1b-closeout.md`
- Modify domain owners, architecture baseline/deployment units, 90-day execution plan, README, Pilot gates.

- [ ] Write docs-validation expectations: active feature, resolvable links to design/four plans, exact commands without secrets, owners for identity/sessions/memberships/authorization.
- [ ] Run `pnpm genesis:validate`; expected FAIL until docs/registries are current.
- [ ] Document bootstrap/recovery, key rotation, lost-device/compromise, user suspension, SMTP/Redis outage, final-owner recovery, audit queries, phased additive rollout and rollback.
- [ ] Run Genesis, check:ci, architecture, migrations, identity-access, Foundation, OpenAPI, build, browser E2E; expected PASS.
- [ ] Commit: `docs: close Sprint 1B identity access`.

## Plan 4 Completion Gate

- [ ] Eight scoped commits exist.
- [ ] All protected routes use authoritative permission/resource policy and stale authority cannot execute logic.
- [ ] `/auth/me/authorization` is current-scope-only/no-store.
- [ ] RLS remains final tenant boundary.
- [ ] Headers/CORS/CSRF/redirect/cache/logging meet invariants.
- [ ] Audit/metrics contain no secrets/high-cardinality identity labels.
- [ ] `S1B-AC01`–`S1B-AC15` and all CI/security gates pass.
- [ ] Feature/pattern/runbooks/owners/baseline/Pilot checkpoint are committed.
- [ ] Open draft PR `feat: complete Sprint 1B identity access core`, request code review, and do not mark ready or merge without explicit instruction.