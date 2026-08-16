# Sprint 1B.4 Authorization and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make backend authorization authoritative on every protected request, reconcile authorization versions, expose `/auth/me/authorization`, harden browser/cache/logging behavior, and close Sprint 1B with full acceptance gates.

**Architecture:** `AuthorizationModule` builds immutable authority from validated session, active user, active membership, system roles/permissions, and target scope. Permission guards consume application ports; grant/resource policies remain pure. Tenant operations still execute through the Sprint 1A RLS transaction so PostgreSQL remains the final boundary.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11.1, Prisma 6.19, PostgreSQL 17 FORCE RLS, Redis 7, OpenAPI 3.1, Node test runner, Supertest, Playwright, pnpm 10, GitHub Actions.

## Execution Status — reconciled 2026-08-14

Status: VERIFIED_COMPLETE — REVIEW_HANDOFF_PENDING  
Current Task: Review handoff; Sprint 1B implementation and Task 8 closeout are verified complete.  
Last verified implementation/closeout baseline: `e5bb19dfcc42bb29aa04c527642e48942902d5b5`

Implementation evidence:

- Task 1 is **VERIFIED IMPLEMENTED**. `ac5433dfbc272db4eb397269ba23f23926fbdb4b` — `feat: build authoritative authorization context`.
- Task 2 is **VERIFIED IMPLEMENTED**. `545d77111dc40dd9a99209c7b9ce5b5d6ea77184` — `feat: enforce permission and resource policies`.
- Task 3 is **VERIFIED COMPLETE**. `c9a11c7bea153b6f16ea1ab6b738596dbac9740f` introduced authorization session snapshots, membership authorization versioning, attacker-header rejection, and stale-authority reconciliation/rotation. Current `main` also contains the planned `authorization-before-use-case.e2e.test.ts` and `authorization-context-concurrency.e2e.test.ts`; request-context and tenant-transaction tests cover spoofed authority headers plus nested tenant/actor/session/snapshot conflicts; CI #1480 completed Unit/API E2E/RLS successfully with these tests in the `test:e2e` glob.
- Task 4 is **VERIFIED COMPLETE** at code baseline `991fbeeb710daeada7adb65cc0f9679ca4c9578a`. The branch exposes current-scope-only `GET /auth/me/authorization`, protects authenticated and unauthenticated authorization responses from shared/browser caching, implements exact-host/CSRF/permission-gated platform incident session revocation, persists `platform.security.session.revoke` through an additive migration, and commits regenerated OpenAPI/API-client artifacts. Fresh GitHub evidence on that baseline: CI run #1562 completed Quality, OpenAPI compatibility, Unit/API E2E/RLS, and migration verification successfully; Sprint 0 gates run #1117 completed OpenAPI generated-artifact check, generated-client typecheck, and repository-generator tests successfully.
- Task 5 is **VERIFIED COMPLETE** at implementation baseline `f887a838059320d447efc3dbd9e2b749a2d460e8`. The implementation enforces the approved API/browser/cache policy across sensitive API and web-console auth surfaces, preserves the `private, no-store` authorization-endpoint exception, rejects unsafe return URLs, bounds recursive redaction with cycle handling, prevents sensitive exception messages/stacks from reaching structured logs, and keeps outbox dead-letter diagnostics bounded without stripping encrypted business payloads. The web-console CSP is request-bound: auth routes receive a fresh nonce, Next.js receives the same request CSP plus `x-nonce`, auth route families render dynamically, static duplicate CSP was removed, and no `unsafe-inline` relaxation is used. A browser-hydration regression was reproduced by Playwright, converted into a real middleware unit regression, and fixed; focused web-console diagnostic run #2 completed successfully after the fix. Standard CI run #1609 on `f887a838059320d447efc3dbd9e2b749a2d460e8` completed Quality, Knowledge validation, OpenAPI compatibility, Docker configuration, Unit/API E2E/RLS, migration verification, Build, Playwright foundation smoke, production configuration guard, dependency audit, and committed-secret scan successfully. Same-head protected workflows API architecture #1098, Sprint 0 gates #1164, and Identity email integration #877 also completed successfully. Direct workflow deletion is blocked by the connector policy, so the temporary CSP diagnostic was converted in `7d1fa581b0501ec5eb77925264d64cb0c17e1667` to a manual-only no-op workflow with no push trigger or diagnostic execution.
- Task 6 is **VERIFIED COMPLETE** at clean implementation baseline `2af5fab3163dcd4e54c483b12ebb765bb74e1d0c`. Security-state mutations now couple their approved audit records to the same Prisma/tenant transaction where required; covered flows include password-reset issuance, session/session-family revocation, membership/role security changes, and authorization denials. Security-audit metadata rejects sensitive nested fields. Auth metrics expose only bounded catalog dimensions (`eventType`, `purpose`, `outcome`, `scope`, `reasonFamily`, `delayBucket`) and do not use raw route/user/tenant identifiers as metric labels. Task 6 diagnostics were removed and the temporary OpenAPI `abortOnError: false` instrumentation was reverted before the final clean-head verification. CI #1717 completed Quality, Knowledge validation, OpenAPI compatibility, Docker configuration, Unit/API E2E/RLS, migration verification, Build, Playwright foundation smoke, production configuration guard, dependency audit, and committed-secret scan successfully. Same-head protected workflows Sprint 0 gates #1272, API architecture #1206, and Identity email integration #985 also completed successfully.
- Task 7 is **VERIFIED COMPLETE** at implementation baseline `38a7b6187ea66ed9c42da8341a7e88073cf8fe81`. The security/RLS/concurrency matrices name and cover `S1B-AC01` through `S1B-AC15`; `verify:identity-access` executes the three matrix suites after API build/migration, CI runs a dedicated `Identity access acceptance` job before Build, and Foundation now includes the identity-access gate. Browser acceptance is committed in `e2e/identity-access.spec.ts`, proving identity-token fragment scrubbing and that failed login does not mint `__Host-booking_session` or render raw password/token material. CI #1728 completed Quality, Knowledge validation, OpenAPI compatibility, Docker configuration, Unit/API E2E/RLS, migration verification, the dedicated identity-access acceptance job, Build, Playwright foundation smoke, production configuration guard, dependency audit, and committed-secret scan successfully. Same-head protected workflows Sprint 0 gates #1283, API architecture #1217, and Identity email integration #996 also completed successfully.
- Task 8 is **VERIFIED COMPLETE** at closeout baseline `e5bb19dfcc42bb29aa04c527642e48942902d5b5`. TDD RED began with `eb810a9b00a3f80a94ba60f1c273a3d0b1e8dcc7`, where Sprint 0 #1285 proved repository validation did not enforce Sprint 1B closeout knowledge. `f20f01c9bfd42cad66a21b4394abe9f2ce280f2b` added minimal Genesis closeout rules; Sprint 0 #1286 moved tooling tests GREEN and produced the expected repository-validation RED for the missing feature/pattern/runbooks/checkpoint/owners. `e5bb19dfcc42bb29aa04c527642e48942902d5b5` committed the active feature, host-bound session pattern, two operational runbooks, closeout checkpoint, domain ownership, architecture/deployment baseline, 90-day plan, README, and Pilot checkpoint. CI #1732 completed Quality, Knowledge validation, OpenAPI compatibility, Docker configuration, Unit/API E2E/RLS, migration verification, Identity access acceptance, Build, Playwright foundation smoke, production configuration guard, dependency audit, and committed-secret scan successfully. Same-head Sprint 0 #1287, API architecture #1221, and Identity email #1000 also completed successfully.

Task 3 evidence details are recorded in `docs/superpowers/checkpoints/2026-08-10-reconciliation-governance-closeout.md`. Task 8 closeout evidence is recorded in `docs/superpowers/checkpoints/2026-08-05-sprint-1b-closeout.md`.

The task checkboxes below are the original execution recipe/evidence checklist. They are not, by themselves, canonical proof of current progress. Before resuming work, inspect current repository evidence and follow `docs/governance/DELIVERY-RECONCILIATION.md`.

Exact permission-key naming for implemented capabilities is governed by `docs/spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`. Do not rename the current Permission Catalog V2 merely to match historical examples in this plan/design.

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

- [x] Write contract tests requiring current user/session/scope/tenant/membership/roles/permissions/versions, excluding other memberships/password/hash/token/abuse fields. Require `Cache-Control: private, no-store`, `Vary: Cookie, Origin`, no ETag/shared cache, JSON UTF-8.
- [x] Run `pnpm --filter @booking-os/api test -- get-current-authorization.use-case.test.ts authorization.controller.test.ts admin-revoke-user-sessions.use-case.test.ts`; RED behavior was established before implementation and the completed root test suite is green on the verified baseline.
- [x] Implement endpoint and explicit platform incident revocation with exact host, permission, CSRF, audit reason, target user.
- [x] Run unit/E2E, OpenAPI generation/check/breaking check; fresh GitHub CI/Sprint 0 gates are green on the verified baseline.
- [x] Commit Task 4 implementation and generated-contract outputs on `feat/sprint-1b-04-task4-authorization-endpoint`.

### Task 5: Browser, Cache, Redirect, Logging, and Outbox Hardening

**Files:**
- Create/test auth security headers interceptor
- Modify API main, HTTP logging interceptor/tests
- Modify observability logger/tests
- Modify worker outbox dispatcher/tests
- Modify web middleware/Next config
- Create/test `apps/web-console/src/lib/security/return-url.ts`
- Create `auth-security-regression.e2e.test.ts`

**Required API headers:** `Content-Security-Policy: default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. Web-console auth pages use the same restrictive baseline plus request-bound nonce directives required by Next.js hydration.

- [x] Write tests for activation/reset/invite/login/me/authorization headers, external/protocol-relative/encoded return URL rejection, recursive redaction of password/cookie/header/token/envelope fields from logs/traces/dead letters/errors, and request-specific web CSP nonces without `unsafe-inline`.
- [x] Run `pnpm --filter @booking-os/api test:e2e -- auth-security-regression.e2e.test.ts`; RED evidence was captured while stale browser/CSP and redaction behavior remained. The web-console hydration failure was also reproduced by Playwright and then encoded in the middleware unit suite.
- [x] Implement route-aware API headers, bounded recursive redaction, no auth request-body logging, sensitive exception-message fail-closed handling, same-origin redirect allowlist, request-bound nonce CSP, and dynamic auth-page rendering.
- [x] Rerun API/observability/worker/web tests and full protected gates; focused web-console diagnostic #2 and standard CI #1609 completed successfully on the verified implementation baseline, including Playwright foundation smoke.
- [x] Task 5 hardening changes are committed on the branch. The temporary diagnostic could not be deleted through the connector policy and is retained only as a disabled manual no-op with no push trigger.

### Task 6: Transactional Audit and Bounded Metrics

**Files:**
- Create/test security-audit port and Prisma adapter
- Create/test auth-metrics adapter
- Modify identity/session/membership use cases to emit approved events
- Create `security-audit.e2e.test.ts`

**Event catalog:** user provisioned/activated/password change-reset; session created/rotated/revoked/reuse; membership invited/resent/accepted/suspended/revoked/owner promoted-demoted; tenant provisioned/activated; bootstrap admin; authorization denied.

- [x] Tests require bounded audit context where known and reject sensitive/nested-sensitive metadata. Metric labels are constrained to the approved bounded catalog: purpose/outcome/scope/reason family/delay bucket/event type.
- [x] RED evidence was established during Task 6 for missing transactional audit coupling/DI and stale test fixtures; targeted adapter/guard tests were then driven to GREEN without weakening the contracts.
- [x] Transactionally coupled audit is implemented for DB-backed security-state mutations, including password-reset issuance, session/session-family revocation, membership/role mutations, and authorization-denial recording; noncritical metrics use only bounded dimensions.
- [x] Unit, audit E2E, API E2E/RLS, architecture, OpenAPI, migration, build, browser smoke, production configuration, dependency audit, and secret-scan gates are GREEN on clean baseline `2af5fab3163dcd4e54c483b12ebb765bb74e1d0c`.
- [x] Task 6 implementation is committed as a branch commit series; temporary Task 6 diagnostics are removed and diagnostic-only OpenAPI bootstrap behavior is reverted on the clean baseline.

### Task 7: Acceptance, Security, RLS, Concurrency, and CI Matrix

**Files:**
- Create `identity-access-security-matrix.e2e.test.ts`, `identity-access-rls-matrix.e2e.test.ts`, `identity-access-concurrency.e2e.test.ts`
- Create `e2e/identity-access.spec.ts`
- Modify CI workflows and root package scripts.

- [x] Encode approved acceptance criteria as named `S1B-AC01` through `S1B-AC15` tests. Host/scope binding, CSRF/origin, enumeration/password/reset, raw-secret handling, session rotation/reuse, grant/final-owner, current-authorization no-store, FORCE RLS, and concurrency evidence are mapped across the security/RLS/concurrency matrices.
- [x] RED evidence was captured on pre-fix head `81a1a0799335903d0afce3c353e1981c3335afad`: CI #1726 failed the repository acceptance test and Sprint 0 #1281 failed `Test repository generators` because Foundation did not invoke `verify:identity-access` and `e2e/identity-access.spec.ts` was missing.
- [x] `verify:identity-access` is wired into root scripts and a named CI `Identity access acceptance` job runs after migration verification and before Build; Foundation preserves the identity-access gate.
- [x] The dedicated identity-access job, full Unit/API E2E/RLS chain, migration verification, Build, Playwright browser suite, OpenAPI compatibility, production guard, dependency audit, and secret scan all pass in CI #1728 on `38a7b6187ea66ed9c42da8341a7e88073cf8fe81`; same-head Sprint 0 #1283, API architecture #1217, and Identity email #996 also pass.
- [x] Task 7 implementation is committed as a branch commit series; reconciliation fix `38a7b6187ea66ed9c42da8341a7e88073cf8fe81` completes the browser acceptance artifact and Foundation wiring without production-code changes.

### Task 8: Feature, Runbook, Rollout, and Closeout Documentation

**Files:**
- Create `docs/features/FEATURE-0002-identity-access-core.md`
- Create `docs/patterns/PATTERN-0003-host-bound-opaque-session.md`
- Create `docs/runbooks/identity-access-recovery.md`, `platform-admin-bootstrap.md`
- Create `docs/superpowers/checkpoints/2026-08-05-sprint-1b-closeout.md`
- Modify domain owners, architecture baseline/deployment units, 90-day execution plan, README, Pilot gates.

- [x] Wrote repository validation expectations first: active feature, resolvable design/four-plan links, exact operational commands without command-line secrets, and assigned Identity/Sessions/Memberships/Authorization ownership. Sprint 0 #1285 captured RED before validator support existed.
- [x] Added the minimal Sprint 1B repository rules in `f20f01c9bfd42cad66a21b4394abe9f2ce280f2b`; Sprint 0 #1286 proved tooling tests GREEN while `genesis:validate` still failed exactly on the missing Task 8 artifacts/owners.
- [x] Documented bootstrap/recovery, host-bound session policy, key rotation, lost-device/session compromise, password reset, user/membership suspension, SMTP/Redis outage, final-owner recovery, bounded audit queries, phased additive rollout, forward-fix migration policy, and schema-compatible rollback.
- [x] Closeout baseline `e5bb19dfcc42bb29aa04c527642e48942902d5b5` passes Genesis, Quality/check:ci-equivalent gates, architecture, OpenAPI compatibility, Unit/API E2E/RLS, migrations, dedicated identity-access acceptance, Build, Playwright browser smoke, production configuration guard, dependency audit, and committed-secret scan in CI #1732; Sprint 0 #1287, API architecture #1221, and Identity email #1000 are also GREEN.
- [x] Task 8 closeout is committed as `e5bb19dfcc42bb29aa04c527642e48942902d5b5` — `docs: close Sprint 1B identity access`.

## Plan 4 Completion Gate

- [x] Eight scoped task histories exist across Tasks 1–8; continuation/debug commits remain bounded to the same task acceptance criteria.
- [x] All protected routes use authoritative permission/resource policy and stale authority cannot execute logic.
- [x] `/auth/me/authorization` is current-scope-only/no-store.
- [x] RLS remains final tenant boundary.
- [x] Headers/CORS/CSRF/redirect/cache/logging meet invariants.
- [x] Audit/metrics contain no secrets/high-cardinality identity labels.
- [x] `S1B-AC01`–`S1B-AC15` and all CI/security gates pass on verified closeout baseline `e5bb19dfcc42bb29aa04c527642e48942902d5b5`.
- [x] Feature/pattern/runbooks/owners/baseline/Pilot checkpoint are committed and Genesis-validated.
- [ ] Draft PR #31 remains open/draft/unmerged for `feat: complete Sprint 1B identity access core`; code-review request is pending a valid external reviewer because the repository currently exposes no CODEOWNERS/reviewer routing beyond the PR author. Do not mark ready or merge without explicit instruction.
