# Sprint 1B.2 Session Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace proof-of-concept sessions with opaque, host-bound, scope-bound session families supporting expiry, rotation, reuse detection, multiple devices, revocation, progressive login delay, and CSRF protection.

**Architecture:** `packages/auth` owns pure token/cookie/expiry/rotation/CSRF policy. `apps/api/src/modules/sessions` owns use cases behind ports. PostgreSQL is authoritative for session families and token history; Redis stores distributed abuse counters only. Next.js is a same-origin BFF and never stores session authority.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11.1, Prisma 6.19, PostgreSQL 17, Redis 7, ioredis 5.11, Node `crypto`, Next.js App Router, Node test runner, Supertest, Playwright, pnpm 10.

## Global Constraints

- Begin after Plan 1 review on branch `feat/sprint-1b-02-session-kernel` from the accepted Plan 1 head.
- Follow red-green-refactor and keep each commit buildable.
- Replace the exported legacy `OpaqueSessionStore`; do not leave two session systems.
- Cookie is `__Host-booking_session`; always `Secure; HttpOnly; SameSite=Lax; Path=/`; never `Domain`.
- Cookie value is `<selector>.<secret>`; DB stores selector plus HMAC-SHA-256 digest only.
- Exact hostname and scope binding is mandatory; tenant and platform sessions never authorize each other.
- Idle expiry is 7 days; absolute expiry is 30 days. Touch writes coalesce to once per 5 minutes.
- Rotate at 15-minute token age and after login, elevation, credential change, invitation acceptance, explicit refresh, or compromise response.
- Previous-token overlap is 30 seconds. Later reuse marks family `compromised`, revokes it, audits, and requires login.
- Multiple devices are allowed and independently revocable.
- Progressive delay keys contain HMAC digests, never raw email/IP.
- Redis outage fails closed for new login with 503 and alert; existing PostgreSQL session validation remains available.
- Unsafe requests require exact Origin plus CSRF. Pre-auth flows reuse Plan 1's hostname-bound contract; authenticated flows are session-bound.
- Auth responses are private/no-store and never expose session secrets in JSON.

---

### Task 1: Session Schema, Constraints, and RLS

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260805_session_kernel/migration.sql`
- Modify tenant policy manifest/verifier tests
- Create: `apps/api/test/session-schema.integration.test.ts`, `session-rls.integration.test.ts`

**Produces:** `AuthSession` and `AuthSessionToken` with scope/tenant/hostname/state/version/idle/absolute/revocation fields and successor/reuse metadata.

- [ ] Write tests for scope shape, tenant consistency, unique selectors, one active successor, tenant FORCE RLS, cross-tenant denial, missing context, and explicit platform path.
- [ ] Run `pnpm --filter @booking-os/api test:e2e -- session-schema.integration.test.ts session-rls.integration.test.ts`; expected FAIL.
- [ ] Implement additive migration, grants, indexes, and policies. Retain replaced tokens until family absolute expiry.
- [ ] Run migration, focused tests, policy verifier, and migration verifier; expected PASS.
- [ ] Commit: `feat: add opaque session persistence`.

### Task 2: Pure Session Protocol

**Files:**
- Rewrite: `packages/auth/src/opaque-session.ts`, `session.ts`
- Create: `session-cookie.ts`, `session-expiry.ts`, `session-rotation.ts`, `csrf-token.ts`
- Modify package exports and exact matching tests; remove obsolete role-coupled legacy assumptions.

**Produces:**
```ts
interface ParsedSessionToken { selector: string; secret: string }
type SessionTokenDisposition = "active" | "overlap" | "reuse" | "expired" | "revoked";
function serializeSessionCookie(token: string): string;
function deriveCsrfToken(input: { csrfKey: Uint8Array; sessionId: string; hostname: string; nonce: string }): string;
```

- [ ] Write tests for entropy/parser/digest, exact cookie attributes, idle/absolute expiry, 5-minute touch coalescing, 15-minute rotation, 30-second overlap, reuse state, concurrent successor policy, and CSRF host/session binding.
- [ ] Run `pnpm --filter @booking-os/auth test`; expected FAIL.
- [ ] Implement deterministic policy functions with no persistence/framework dependencies and delete legacy exports.
- [ ] Rerun auth tests/typecheck/lint; expected PASS.
- [ ] Commit: `feat: define opaque session protocol`.

### Task 3: Session Application Kernel and Prisma Transactions

**Files:**
- Create domain: `auth-session.ts`, `auth-session-token.ts`, `session-errors.ts`
- Create ports: `session-repository.port.ts`, `security-audit.port.ts`
- Create use cases/tests: `create-session`, `validate-session`, `refresh-session`, `revoke-session`
- Create Prisma repository adapter/test, `sessions.tokens.ts`, `sessions.module.ts`
- Modify `AppModule` and architecture manifest.

**Produces:**
```ts
interface SessionRepositoryPort {
  create(input: CreateSessionRecord): Promise<IssuedSession>;
  findBySelector(input: SessionLookup): Promise<StoredSessionWithToken | null>;
  rotateCompareAndSet(input: RotateSessionInput): Promise<RotationResult>;
  markCompromised(input: MarkCompromisedInput): Promise<void>;
  touchIfDue(input: TouchSessionInput): Promise<void>;
  revokeById(input: RevokeSessionInput): Promise<boolean>;
  revokeAllForUser(input: RevokeAllUserSessionsInput): Promise<number>;
  listForUser(input: ListSessionsInput): Promise<readonly SessionSummary[]>;
}
```

- [ ] Write use-case tests for host/scope/state/expiry/overlap/reuse/version snapshots and Prisma concurrency tests proving one successor.
- [ ] Run `pnpm --filter @booking-os/api test -- "apps/api/src/modules/sessions/**/*.test.ts"`; expected FAIL.
- [ ] Implement ports/use cases/adapters using row locks or compare-and-set; expose no Prisma types.
- [ ] Rerun focused tests, typecheck, architecture; expected PASS.
- [ ] Commit: `feat: add session application kernel`.

### Task 4: Distributed Progressive Delay

**Files:**
- Create: `application/ports/login-abuse-protection.port.ts`, `application/login-abuse-key.ts` and test
- Create: `infrastructure/abuse/redis-login-abuse-protection.adapter.ts` and test
- Modify dependency tokens/module and observability tokens.

**Produces:**
```ts
interface LoginAbuseProtectionPort {
  beforeAttempt(input: LoginAttemptKey): Promise<{ delayMs: number }>;
  recordFailure(input: LoginAttemptKey): Promise<void>;
  recordSuccess(input: LoginAttemptKey): Promise<void>;
}
```

- [ ] Write tests for HMAC key derivation, IPv4/IPv6 privacy summaries, account/source/combined counters, exponential ceiling/TTL, success decay, Lua atomicity, and fail-closed Redis outage.
- [ ] Run `pnpm --filter @booking-os/api test -- "*login-abuse*"`; expected FAIL.
- [ ] Implement adapter and bounded metrics (`purpose`, `outcome`, `delay_bucket`, availability only).
- [ ] Rerun focused tests/typecheck; expected PASS.
- [ ] Commit: `feat: add distributed login abuse protection`.

### Task 5: Login and Trusted Authentication Context

**Files:**
- Create ports: `credential-verifier.port.ts`, `session-subject.port.ts`
- Create: `login.use-case.ts`, `get-current-session.use-case.ts` and tests
- Create: `session-auth.middleware.ts`, `session-required.guard.ts` and tests
- Modify request-context types/storage/tests and sessions module.

**Produces:**
```ts
interface AuthenticatedRequestContext extends RequestContext {
  actorId: string;
  sessionId: string;
  authScope: { type: "platform" } | { type: "tenant"; tenantId: string };
  sessionState: "active" | "invitation_pending";
}
```

- [ ] Write login tests for platform assignment, tenant subject hook, generic errors, Argon2 rehash, abuse calls, and exact host issuance. Write middleware tests proving headers cannot inject actor/scope and invalid sessions fail before controllers.
- [ ] Run `pnpm --filter @booking-os/api test -- login.use-case.test.ts session-auth.middleware.test.ts session-required.guard.test.ts`; expected FAIL.
- [ ] Implement login and middleware after trusted tenant resolution. Health/readiness remain outside auth.
- [ ] Rerun focused tests/typecheck/architecture; expected PASS.
- [ ] Commit: `feat: authenticate host-bound sessions`.

### Task 6: Origin, CSRF, and Session HTTP Surface

**Files:**
- Create: `csrf.controller.ts`, `csrf.guard.ts`, `origin-policy.ts`, `auth.controller.ts`, DTOs and exact tests
- Create: `apps/api/test/auth-session.e2e.test.ts`
- Modify: `apps/api/src/main.ts`, environment schema, OpenAPI document test.

**Routes:** `POST /auth/login`, `/auth/logout`, `/auth/session/refresh`, `GET /auth/csrf`, `/auth/me`, `/auth/sessions`, `DELETE /auth/sessions/:sessionId`, `POST /auth/sessions/revoke-others`.

- [ ] Write tests for exact origins, no wildcard credentials, wrong host/scheme/port, pre-auth and session-bound CSRF, token replay after rotation, cookie attributes, cross-host/scope replay, expiry, rotation/reuse, list/revoke/logout.
- [ ] Run `pnpm --filter @booking-os/api test -- csrf.guard.test.ts origin-policy.test.ts auth.controller.test.ts`; expected FAIL.
- [ ] Implement guards/controllers. Raw replacement tokens travel only through `Set-Cookie`; `/auth/me` is private/no-store.
- [ ] Run focused tests, API E2E, OpenAPI generation/check, build; expected PASS.
- [ ] Commit: `feat: expose secure session endpoints`.

### Task 7: Replace Web Console Sample Session

**Files:**
- Delete sample session and in-memory store files/tests.
- Rewrite `apps/web-console/src/lib/session/session-cookie.ts`, `csrf.ts`, `session-route-handlers.ts`.
- Create BFF routes/tests for login/logout/csrf/sessions.
- Create login and security/session pages/components/tests.
- Modify web middleware and Foundation E2E; create `e2e/auth-session.spec.ts`.

- [ ] Write tests for controlled Host/Origin forwarding, opaque cookie passthrough, no JS-visible secret, safe errors/no-store, same-origin return URLs, and multiple browser contexts.
- [ ] Run `pnpm --filter @booking-os/web-console test`; expected FAIL.
- [ ] Implement same-origin BFF without storing authority in Next.js memory.
- [ ] Run web tests, browser E2E, and `pnpm verify:foundation`; expected PASS.
- [ ] Commit: `feat: connect console to opaque sessions`.

## Plan 2 Completion Gate

- [ ] Seven scoped commits exist.
- [ ] 7-day idle, 30-day absolute, 15-minute rotation, 30-second overlap, and post-overlap compromise are verified.
- [ ] Exact host/scope binding and `__Host-booking_session` attributes are verified.
- [ ] New login fails closed during abuse-store outage; existing sessions remain verifiable.
- [ ] Every unsafe browser request requires exact Origin and CSRF.
- [ ] Multiple-device listing/revocation/logout work and sample in-memory sessions are removed.
- [ ] `pnpm verify:foundation` passes.
- [ ] Open draft PR `feat: establish Sprint 1B session kernel`; stop for review before Plan 3.