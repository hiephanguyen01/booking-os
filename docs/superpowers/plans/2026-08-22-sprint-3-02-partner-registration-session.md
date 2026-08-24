# Sprint 3.2 Partner Registration & Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver enumeration-safe Partner registration, single-use email verification, atomic Partner establishment, and authoritative host-bound Partner-scoped sessions on top of the shared identity/session kernel.

**Architecture:** Registration lives in the Partner module but reuses `OneTimeTokenPort`, identity password/activation policy, outbox/audit primitives, and the existing session repository/cookie model through exported application-facing contracts. A verified email challenge establishes exactly one Partner relationship; new users set a password during verified completion, existing active users are reused, and suspended/disabled users fail closed. Partner sessions bind host + tenant + Partner + all authorization-version snapshots and rotate material on scope establishment.

**Tech Stack:** Node.js >=22 <25, pnpm >=10 <11, TypeScript 5.9.3, NestJS 11.1.28, Prisma 6.19.3, PostgreSQL 17 FORCE RLS, Node test runner, Supertest, existing `OneTimeTokenPort`, Argon2 credential policy, opaque session/cookie infrastructure, OpenAPI tooling.

**Spec:** `docs/superpowers/specs/2026-08-22-sprint-3-partner-foundation-onboarding-design.md`

## Global Constraints

- Plan 3.1 completion gate must be GREEN on the same implementation branch before this plan begins.
- Registration must not reveal whether an email already exists, is new, or already has a Partner relationship.
- Raw verification secrets are never stored, logged, audited, included in metrics, or placed in query-string server logs.
- Reuse `OneTimeTokenPort.issue/derive/verify`; do not create a second token cryptography implementation.
- New users create their password only after presenting a valid Partner registration challenge; existing active users are reused without credential mutation.
- Existing `pending_activation` users may complete activation through the same verified completion path only after passing the existing password policy; `suspended` and `disabled` users fail closed.
- Partner creation, PartnerMembership creation, `partner_owner` system-role assignment, challenge consumption, audit/history, and required outbox writes commit atomically.
- Session material is issued/rotated only after the establishment transaction commits.
- Partner scope authority always derives from authoritative server state; route/header/body Partner IDs never select authority.
- State-changing browser requests after session establishment keep exact approved Origin + CSRF + host-only `__Host-` cookie rules.
- Wrong-host, wrong-tenant, wrong-Partner, stale-version, inactive membership, suspended Partner, and cancelled Partner authority fail closed.
- Use TDD with PostgreSQL for token double-consume, establishment uniqueness, and stale-authority behavior.

---

## File Structure

- `apps/api/prisma/schema.prisma` — `partner_registration_challenges` plus relations/indexes.
- `apps/api/prisma/migrations/<timestamp>_partner_registration/migration.sql` — challenge table, FORCE RLS, selector uniqueness, exact DML.
- `apps/api/src/modules/identity/application/partner-registration-identity.contract.ts` — exported identity application contract used by Partner registration.
- `apps/api/src/modules/identity/application/partner-registration-identity.service.ts` — existing/new User resolution and password policy orchestration.
- `apps/api/src/modules/identity/identity.module.ts` — exports only the application-facing registration contract token/service.
- `apps/api/src/modules/partners/application/ports/partner-registration-challenge-repository.port.ts` — challenge persistence contract.
- `apps/api/src/modules/partners/application/ports/partner-registration-notifier.port.ts` — outbox-facing verification notification contract.
- `apps/api/src/modules/partners/application/use-cases/start-partner-registration.ts` — enumeration-safe start.
- `apps/api/src/modules/partners/application/use-cases/complete-partner-registration.ts` — verified atomic establishment.
- `apps/api/src/modules/partners/infrastructure/persistence/prisma/prisma-partner-registration-challenge-repository.adapter.ts` — tenant-scoped challenge persistence.
- `apps/api/src/modules/partners/infrastructure/http/partner-registration.controller.ts` — public start/complete boundary.
- `apps/api/src/modules/partners/infrastructure/http/partner-registration.dto.ts` — closed request/response DTOs.
- `apps/api/src/modules/sessions/application/ports/session-repository.port.ts` — extend session persistence inputs/records with Partner scope fields.
- `apps/api/src/modules/sessions/application/ports/session-subject.port.ts` — allow authoritative Partner subject/snapshot.
- `apps/api/src/modules/sessions/application/use-cases/*` — extend session issue/refresh/authentication reconciliation for Partner scope where existing use cases own those responsibilities.
- `apps/api/src/modules/sessions/sessions.module.ts` — Partner authority bridge wiring.
- `apps/api/src/modules/partners/partners.module.ts` — registration/controller/session bridge composition.
- `apps/api/src/openapi/*` and generated API client artifacts — public contract generation.
- `apps/api/test/partner-registration.e2e.test.ts` — start/complete/idempotency/security E2E.
- `apps/api/test/partner-registration-concurrency.e2e.test.ts` — double consume/duplicate establishment races.
- `apps/api/test/partner-session-authority.e2e.test.ts` — wrong host/scope/stale authority proofs.

### Task 1: Add Partner registration challenge persistence and identity bridge

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_partner_registration/migration.sql`
- Modify: `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.ts`
- Create: `apps/api/src/modules/identity/application/partner-registration-identity.contract.ts`
- Create: `apps/api/src/modules/identity/application/partner-registration-identity.service.ts`
- Create: `apps/api/src/modules/identity/application/partner-registration-identity.service.test.ts`
- Modify: `apps/api/src/modules/identity/identity.module.ts`
- Create: `apps/api/src/modules/partners/application/ports/partner-registration-challenge-repository.port.ts`
- Create: `apps/api/src/modules/partners/infrastructure/persistence/prisma/prisma-partner-registration-challenge-repository.adapter.ts`
- Test: `apps/api/test/partner-registration-schema.integration.test.ts`

**Interfaces:**
- Consumes: `OneTimeTokenPort`, existing identity repository/password hasher/password policy, Partner transaction foundation from Plan 3.1.
- Produces: `PartnerRegistrationIdentityContract`, `PartnerRegistrationChallengeRepositoryPort`, tenant-scoped challenge table.

- [ ] **Step 1: Write RED schema and identity-contract tests**

Challenge persistence must carry only safe registration metadata plus the token digest:

```ts
assert.equal(await isForceRls("partner_registration_challenges"), true);
assert.equal(await hasUniqueIndex("partner_registration_challenges", ["selector"]), true);
assert.equal(await hasColumn("partner_registration_challenges", "token_hash"), true);
assert.equal(await hasColumn("partner_registration_challenges", "serialized_token"), false);
```

Identity service tests must cover:

```ts
await assert.rejects(
  () => service.resolveVerifiedPartnerIdentity({
    normalizedEmail: "blocked@example.test",
    displayEmail: "blocked@example.test",
    password: "Valid-Password-123!",
  }),
  IdentityUnavailableForPartnerRegistrationError,
);
```

for suspended/disabled users, and must reuse active users without replacing credentials.

- [ ] **Step 2: Run RED tests**

```bash
node --test --import tsx apps/api/src/modules/identity/application/partner-registration-identity.service.test.ts
node --test --test-concurrency=1 --import tsx apps/api/test/partner-registration-schema.integration.test.ts
```

Expected: FAIL because the contract/table do not exist.

- [ ] **Step 3: Add challenge model and migration**

Use this shape:

```prisma
model PartnerRegistrationChallenge {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId        String   @db.Uuid @map("tenant_id")
  normalizedEmail String   @map("normalized_email")
  displayEmail    String   @map("display_email")
  partnerType     PartnerType @map("partner_type")
  hostname        String
  selector        String   @unique
  tokenHash       String   @db.Char(64) @map("token_hash")
  expiresAt       DateTime @db.Timestamptz(6) @map("expires_at")
  consumedAt      DateTime? @db.Timestamptz(6) @map("consumed_at")
  revokedAt       DateTime? @db.Timestamptz(6) @map("revoked_at")
  completedPartnerId String? @db.Uuid @map("completed_partner_id")
  createdAt       DateTime @default(now()) @db.Timestamptz(6) @map("created_at")

  @@index([tenantId, normalizedEmail])
  @@index([expiresAt])
  @@map("partner_registration_challenges")
}
```

Enable/FORCE RLS using canonical `app.tenant_id`, grant only `SELECT, INSERT, UPDATE` to `booking_app`, and add the table to the tenant policy manifest.

- [ ] **Step 4: Define the exported identity application contract**

```ts
export interface ResolveVerifiedPartnerIdentityInput {
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly password?: string;
}

export interface VerifiedPartnerIdentity {
  readonly userId: string;
  readonly authorizationVersion: number;
  readonly wasCreatedOrActivated: boolean;
}

export interface PartnerRegistrationIdentityContract {
  resolveVerifiedPartnerIdentity(input: ResolveVerifiedPartnerIdentityInput): Promise<VerifiedPartnerIdentity>;
}
```

Behavior:
- existing `active` user -> reuse, no password mutation;
- existing `pending_activation` user -> require valid password, set credential and activate through existing identity rules;
- no user -> require valid password, create canonical User + credential in active verified state through existing identity logic;
- `suspended|disabled` -> fail closed.

Do not expose identity repository or Prisma to Partner code.

- [ ] **Step 5: Implement challenge repository port/adapter**

```ts
export interface PartnerRegistrationChallengeRepositoryPort {
  revokeOpenForEmail(normalizedEmail: string, now: Date): Promise<void>;
  create(input: CreatePartnerRegistrationChallengeInput): Promise<PartnerRegistrationChallengeRecord>;
  lockBySelector(selector: string): Promise<PartnerRegistrationChallengeRecord | null>;
  markCompleted(input: { challengeId: string; partnerId: string; consumedAt: Date }): Promise<void>;
}
```

All methods run inside an established tenant transaction.

- [ ] **Step 6: Run GREEN checks and commit**

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
pnpm verify:migrations
pnpm verify:architecture
```

```bash
git add apps/api/prisma apps/api/src/modules/identity apps/api/src/modules/partners apps/api/src/modules/tenancy apps/api/test/partner-registration-schema.integration.test.ts
git commit -m "feat: add partner registration foundation"
```

### Task 2: Implement enumeration-safe registration start and verification notification

**Files:**
- Create: `apps/api/src/modules/partners/application/ports/partner-registration-notifier.port.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/start-partner-registration.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/start-partner-registration.test.ts`
- Modify/Create: Partner outbox adapter under `apps/api/src/modules/partners/infrastructure/persistence/prisma/`
- Modify: `apps/api/src/common/security/security-audit-events.ts`
- Modify: `apps/api/src/common/security/security-audit-events.test.ts`

**Interfaces:**
- Consumes: `OneTimeTokenPort`, challenge repository, tenant host context, outbox/audit infrastructure.
- Produces: enumeration-safe `StartPartnerRegistration` and `partner.registration.verification_requested` outbox event.

- [ ] **Step 1: Write RED tests for identical public behavior**

Test the same output for new email, existing active user, existing Partner user, and blocked user:

```ts
assert.deepEqual(result, { accepted: true });
assert.equal(resultExisting.accepted, true);
assert.equal(resultBlocked.accepted, true);
```

Internally assert only eligible flows create a usable challenge; the external response remains identical.

- [ ] **Step 2: Run RED unit tests**

```bash
node --test --import tsx apps/api/src/modules/partners/application/use-cases/start-partner-registration.test.ts
```

- [ ] **Step 3: Implement start use case**

```ts
const issued = oneTimeToken.issue("partner_registration");
await transaction.run(context, async (session) => {
  await session.partnerRegistrationChallenges.revokeOpenForEmail(normalizedEmail, now);
  await session.partnerRegistrationChallenges.create({
    tenantId: context.tenantId,
    normalizedEmail,
    displayEmail,
    partnerType,
    hostname: context.hostname,
    selector: issued.selector,
    tokenHash: issued.tokenHash,
    expiresAt,
  });
  await session.partnerOutbox.appendVerificationRequested({
    normalizedEmail,
    serializedToken: issued.serialized,
    hostname: context.hostname,
  });
});
return { accepted: true as const };
```

The raw serialized token may exist only in the outbound email payload boundary, never in audit metadata or metrics.

- [ ] **Step 4: Add bounded audit/metrics catalog entries**

Audit registration start only with safe result/reason dimensions; no email/token labels. Keep the public response enumeration-safe even if internal policy suppresses delivery.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @booking-os/api test
pnpm typecheck
```

```bash
git add apps/api/src/modules/partners apps/api/src/common/security
git commit -m "feat: start partner registration"
```

### Task 3: Implement verified atomic Partner establishment with concurrency-safe idempotency

**Files:**
- Create: `apps/api/src/modules/partners/application/use-cases/complete-partner-registration.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/complete-partner-registration.test.ts`
- Test: `apps/api/test/partner-registration-concurrency.e2e.test.ts`
- Modify: Partner repository/session interfaces only if the RED evidence requires an establishment-specific atomic operation.

**Interfaces:**
- Consumes: challenge lock, identity contract, Partner root/membership/system-role repositories, `OneTimeTokenPort.verify`, security audit/outbox.
- Produces: exactly one established Partner and initial `partner_owner` authority for a verified email.

- [ ] **Step 1: Write RED unit and PostgreSQL race tests**

Cover:

```ts
const [a, b] = await Promise.allSettled([
  complete(command),
  complete(command),
]);
assert.equal(await countPartnersForChallenge(challengeId), 1);
assert.equal(await countActiveOwnerAssignmentsForChallenge(challengeId), 1);
```

Also prove expired, revoked, wrong-host, wrong-purpose, and invalid-token cases do not consume or establish anything.

- [ ] **Step 2: Prove RED**

```bash
node --test --import tsx apps/api/src/modules/partners/application/use-cases/complete-partner-registration.test.ts
node --test --test-concurrency=1 --import tsx apps/api/test/partner-registration-concurrency.e2e.test.ts
```

- [ ] **Step 3: Implement lock/verify/establish transaction**

Required order:

```text
challenge row FOR UPDATE
-> verify tenant/host/not expired/not revoked
-> verify OneTimeTokenPort token hash with purpose partner_registration
-> if completedPartnerId already exists, return canonical established result
-> resolve verified global identity
-> create Partner(draft,inactive,authorizationVersion=1,version=1)
-> create active PartnerMembership linked to same-tenant TenantMembership/identity bridge result
-> create partner_owner system-role assignment
-> mark challenge consumed + completedPartnerId
-> append status/audit/outbox
-> commit
```

Use a unique establishment constraint keyed by the registration challenge so concurrent completions cannot create two Partner roots even if application locking regresses.

- [ ] **Step 4: Make repeated completion canonical and side-effect idempotent**

A second request after successful commit returns the already established Partner identity but must not create another audit/outbox/role assignment.

- [ ] **Step 5: Run GREEN race suite and commit**

```bash
pnpm --filter @booking-os/api test
node --test --test-concurrency=1 --import tsx apps/api/test/partner-registration-concurrency.e2e.test.ts
pnpm verify:migrations
```

```bash
git add apps/api/src/modules/partners apps/api/test/partner-registration-concurrency.e2e.test.ts
git commit -m "feat: complete partner registration"
```

### Task 4: Extend shared opaque sessions with authoritative Partner scope and stale-authority reconciliation

**Files:**
- Modify: `apps/api/src/modules/sessions/application/ports/session-repository.port.ts`
- Modify: `apps/api/src/modules/sessions/application/ports/session-subject.port.ts`
- Modify: relevant existing session issue/authenticate/refresh use cases under `apps/api/src/modules/sessions/application/use-cases/`
- Modify: relevant Prisma session repository adapters under `apps/api/src/modules/sessions/infrastructure/`
- Modify: `apps/api/src/modules/sessions/sessions.module.ts`
- Modify: `apps/api/src/modules/sessions/sessions.tokens.ts` only if a new exported application contract token is required.
- Test: `apps/api/test/partner-session-authority.e2e.test.ts`
- Test: existing session/authORIZATION context regression tests.

**Interfaces:**
- Consumes: `PartnerAuthorizationQueryPort` from Plan 3.1 and existing User/TenantMembership authoritative subject loading.
- Produces: Partner-scoped opaque session issue/refresh/authentication with four version snapshots.

- [ ] **Step 1: Write RED session tests**

Expected Partner session record:

```ts
assert.equal(session.scopeType, "partner");
assert.equal(session.tenantId, tenant.id);
assert.equal(session.partnerId, partner.id);
assert.equal(session.authorizationVersion, user.authorizationVersion);
assert.equal(session.membershipAuthorizationVersion, tenantMembership.authorizationVersion);
assert.equal(session.partnerAuthorizationVersion, partner.authorizationVersion);
assert.equal(session.partnerMembershipAuthorizationVersion, partnerMembership.authorizationVersion);
```

Prove wrong hostname, foreign Partner, suspended/cancelled Partner, inactive/revoked PartnerMembership, or mismatched version fails before protected use-case execution.

- [ ] **Step 2: Run RED session tests**

```bash
node --test --test-concurrency=1 --import tsx apps/api/test/partner-session-authority.e2e.test.ts
```

- [ ] **Step 3: Extend session repository records/commands**

Add optional Partner fields only when `scopeType === "partner"`. Enforce shape validation so Platform/Tenant sessions cannot carry a Partner ID and Partner sessions cannot omit it.

- [ ] **Step 4: Extend authoritative subject reconciliation**

Partner authorization reconstruction must require all of:

```ts
user.status === "active"
tenantMembership.status === "active"
partnerMembership.status === "active"
partner.operationalStatus !== "cancelled"
session.hostname === trustedHostname
session.tenantId === trustedTenantId
session.partnerId === authoritativePartnerId
```

Then compare all four authorization-version snapshots. A stale snapshot must trigger the same fail-closed/rotation/reconciliation semantics used by the existing session kernel; do not trust permissions serialized in the browser.

- [ ] **Step 5: Rotate/issue session only after Partner establishment commit**

Expose an application-facing session-establishment contract to the Partner module rather than importing session persistence. Scope elevation must issue new session material and invalidate/replace the prior browser token according to current session fixation protections.

- [ ] **Step 6: Run inherited and Partner GREEN gates**

```bash
pnpm verify:identity-access
pnpm verify:dynamic-rbac
pnpm --filter @booking-os/api test:e2e
pnpm typecheck
```

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/api/src/modules/sessions apps/api/src/modules/partners apps/api/test/partner-session-authority.e2e.test.ts
git commit -m "feat: add partner scoped sessions"
```

### Task 5: Expose public registration HTTP/OpenAPI flow with browser security contracts

**Files:**
- Create: `apps/api/src/modules/partners/infrastructure/http/partner-registration.controller.ts`
- Create: `apps/api/src/modules/partners/infrastructure/http/partner-registration.dto.ts`
- Create: `apps/api/src/modules/partners/infrastructure/http/partner-registration.controller.test.ts`
- Modify: `apps/api/src/modules/partners/partners.module.ts`
- Modify: `apps/api/src/openapi/generate-openapi.test.ts`
- Create: `apps/api/src/openapi/partner-registration-openapi.contract.test.ts`
- Generate: `packages/contracts/openapi/openapi.json`
- Generate: `packages/api-client/src/generated/schema.ts`
- Generate: `packages/api-client/src/generated/client.ts`
- Test: `apps/api/test/partner-registration.e2e.test.ts`

**Interfaces:**
- Consumes: `StartPartnerRegistration`, `CompletePartnerRegistration`, Partner session establishment contract.
- Produces: public registration API and generated client contract.

- [ ] **Step 1: Write RED HTTP/security tests**

Public start:

```http
POST /api/partner-registration/start
Content-Type: application/json

{"email":"owner@example.test","partnerType":"individual"}
```

Always return an enumeration-safe accepted response for syntactically valid requests.

Completion:

```http
POST /api/partner-registration/complete
Content-Type: application/json

{"token":"<fragment-scrubbed-secret>","password":"Valid-Password-123!"}
```

`password` is required only when identity resolution needs to create/activate a credential. Never return the raw token.

- [ ] **Step 2: Implement stable DTO/error mapping**

Use stable codes:

```text
PARTNER_REGISTRATION_TOKEN_INVALID
PARTNER_REGISTRATION_TOKEN_EXPIRED
PARTNER_REGISTRATION_TOKEN_CONSUMED
PARTNER_REGISTRATION_NOT_ALLOWED
```

Do not distinguish unknown-vs-foreign tenant/Partner existence in public error text.

- [ ] **Step 3: Preserve fragment scrubbing contract**

The browser route consuming the email link must read the `#fragment`, remove it from location/history before analytics/referrer-capable navigation, then POST the secret same-origin. The API itself must never require a query-string token.

- [ ] **Step 4: Generate and verify OpenAPI/client artifacts**

```bash
pnpm api:generate
pnpm api:check-generated
pnpm api:check-breaking
```

- [ ] **Step 5: Run registration E2E and regression gates**

```bash
pnpm --filter @booking-os/api test:e2e
pnpm verify:identity-access
pnpm verify:dynamic-rbac
pnpm build
```

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/api/src/modules/partners apps/api/src/openapi apps/api/test/partner-registration.e2e.test.ts packages/contracts/openapi packages/api-client
git commit -m "feat: expose partner registration flow"
```

## Plan 3.2 Completion Gate

- [ ] Registration start is enumeration-safe for new/existing/blocked addresses.
- [ ] Partner registration tokens are purpose/host/tenant bound, single-use, digest-only at rest, and absent from logs/audit/metrics.
- [ ] New verified users receive canonical credentials via existing identity password policy; active users are reused; suspended/disabled users fail closed.
- [ ] Partner + PartnerMembership + `partner_owner` + challenge consume + audit/outbox establish atomically.
- [ ] Concurrent/repeated completion creates exactly one Partner relationship and one real side-effect set.
- [ ] Partner sessions bind host + tenant + Partner + User/TenantMembership/Partner/PartnerMembership authorization versions.
- [ ] Wrong-host/scope and stale Partner authority fail closed before protected logic.
- [ ] Scope establishment rotates/creates opaque session material only after commit.
- [ ] Public HTTP/OpenAPI/generated-client contract is additive and secret-safe.
- [ ] Identity-access and Sprint 2 dynamic-RBAC regression gates remain green.
