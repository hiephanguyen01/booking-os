# Single-Email Initial Owner Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a brand-new initial tenant owner receive exactly one onboarding email and complete activation, password authentication, invitation review, and explicit invitation acceptance without weakening existing identity/session boundaries.

**Architecture:** Keep activation and invitation as independently bound one-time tokens, but seal both into one owner-onboarding outbox envelope for pending initial owners. The worker decrypts the pair only to build a fragment-only onboarding link. After activation, the API returns server-derived continuation email metadata; the web console authenticates normally to obtain an `invitation_pending` session and then routes to the unchanged explicit invitation acceptance flow.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11, Prisma 6.19, PostgreSQL FORCE RLS, Next.js 16 App Router, React 19, BullMQ worker, pnpm 10.34.5, Node test runner, Playwright.

## Global Constraints

- Branch: `feat/owner-onboarding-single-email`; do not write directly to `main`.
- New/pending initial owner receives exactly one onboarding email.
- Existing active initial owner continues to receive exactly one normal membership invitation email.
- Tenant-admin invitation behavior is unchanged.
- Activation token and invitation token remain separate exact-host/tenant/user/purpose-bound artifacts.
- Invitation token alone never authenticates or creates a session.
- Password authentication is mandatory before invitation acceptance.
- Invitation acceptance remains explicit and requires an `invitation_pending` session.
- No raw token in query strings, localStorage, sessionStorage, logs, audit metadata, or server-rendered HTML.
- Fragment secrets are stripped from browser history before submission.
- Raw outbox secrets remain AES-GCM encrypted at rest.
- Platform activation, password reset, final-owner invariant, FORCE RLS, session rotation, and authorization reconciliation must not regress.

---

### Task 1: Seal pending-owner activation and invitation into one outbox event

**Files:**
- Create: `apps/api/src/modules/memberships/application/ports/initial-owner-onboarding-envelope.port.ts`
- Modify: `apps/api/src/modules/memberships/infrastructure/crypto/aes-membership-provisioning-envelope.adapter.ts`
- Modify: `apps/api/src/modules/memberships/memberships.module.ts`
- Modify: `apps/api/src/modules/memberships/application/use-cases/platform-tenant-provisioning.workflow.ts`
- Test: `apps/api/src/modules/memberships/application/use-cases/platform-tenant-provisioning.workflow.test.ts`
- Test: `apps/api/src/modules/memberships/infrastructure/crypto/aes-membership-provisioning-envelope.adapter.test.ts`
- Test: `apps/api/test/platform-tenant-provisioning.e2e.test.ts`

**Interfaces:**
- Produces event type `membership.owner_onboarding.requested.v1`.
- Produces `InitialOwnerOnboardingEnvelopePort.seal(input)` where input includes event/tenant/invitation/user/hostname/recipient plus both serialized tokens.
- Existing `membership.owner_invitation.requested.v1` remains unchanged for active identities.

- [ ] **Step 1: Add failing workflow tests for the one-email rule**

Add assertions equivalent to:

```ts
assert.equal(ownerIdentity.status, "pending_activation");
assert.deepEqual(outboxEvents.map((event) => event.type), [
  "membership.owner_onboarding.requested.v1",
]);
assert.equal(JSON.stringify(outboxEvents).includes(RAW_ACTIVATION_TOKEN), false);
assert.equal(JSON.stringify(outboxEvents).includes(RAW_INVITATION_TOKEN), false);
```

Keep the existing-active-owner test asserting exactly one `membership.owner_invitation.requested.v1` event.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- platform-tenant-provisioning.workflow.test.ts
```

Expected: FAIL because pending owners currently append invitation and activation events separately.

- [ ] **Step 3: Add the combined envelope contract and AES adapter**

The port must expose:

```ts
export interface SealInitialOwnerOnboardingInput {
  readonly eventId: string;
  readonly tenantId: string;
  readonly invitationId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly recipient: string;
  readonly activationToken: string;
  readonly invitationToken: string;
}

export interface InitialOwnerOnboardingEnvelopePort {
  seal(input: SealInitialOwnerOnboardingInput): SensitiveEnvelopeValue;
}
```

Encrypt JSON `{ activationToken, invitationToken }` using AAD:

```text
booking-os:owner-onboarding-email:v1\0membership.owner_onboarding.requested.v1\0<eventId>\0<tenantId>\0<invitationId>\0<userId>\0<hostname>\0<recipient>
```

- [ ] **Step 4: Change provisioning/resend minimal behavior**

For `pending_activation`, append only:

```ts
{
  type: "membership.owner_onboarding.requested.v1",
  aggregateType: "membership_invitation",
  aggregateId: invitation.id,
  payload: {
    version: 1,
    recipient,
    hostname,
    userId,
    purpose: "initial_owner_onboarding",
    envelope: combinedEnvelope,
  },
}
```

Still persist the activation token through `issueTenantActivation`. For `active`, keep the current invitation event. Apply the identical split to `resendOwnerInvitation`.

- [ ] **Step 5: Run API unit/E2E tests and verify GREEN**

```bash
pnpm --filter @booking-os/api test -- platform-tenant-provisioning.workflow.test.ts aes-membership-provisioning-envelope.adapter.test.ts
pnpm --filter @booking-os/api test:e2e -- platform-tenant-provisioning.e2e.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/memberships apps/api/test/platform-tenant-provisioning.e2e.test.ts
git commit -m "feat: emit single owner onboarding event"
```

---

### Task 2: Teach the critical worker to decrypt and send the onboarding message

**Files:**
- Modify: `apps/worker-critical/src/identity-email/identity-email-event.ts`
- Modify: `apps/worker-critical/src/identity-email/identity-email-event.test.ts`
- Modify: `apps/worker-critical/src/identity-email/sensitive-envelope.ts`
- Modify: `apps/worker-critical/src/identity-email/sensitive-envelope.test.ts`
- Modify: `apps/worker-critical/src/identity-email/identity-email-dispatcher.ts`
- Modify: `apps/worker-critical/src/identity-email/identity-email-dispatcher.test.ts`
- Modify if required by event routing: `apps/worker-critical/src/queue/providers.ts`

**Interfaces:**
- Consumes `membership.owner_onboarding.requested.v1` from Task 1.
- Produces parsed template `initial_owner_onboarding` and decrypted `{ activationToken, invitationToken }`.

- [ ] **Step 1: Add failing parser/decrypt/dispatcher tests**

Tests must assert:

```ts
assert.equal(parsed.template, "initial_owner_onboarding");
assert.deepEqual(decrypted, { activationToken, invitationToken });
assert.equal(message.subject, "Set up your Booking OS workspace");
assert.match(message.text, /#activation=/);
assert.match(message.text, /&invitation=/);
```

Also assert malformed/missing pair data is non-retryable and neither raw token is included in emitted diagnostic objects.

- [ ] **Step 2: Run worker tests and verify RED**

```bash
pnpm --filter @booking-os/worker-critical test -- identity-email-event.test.ts sensitive-envelope.test.ts identity-email-dispatcher.test.ts
```

- [ ] **Step 3: Extend event parsing and decryption**

Add constant:

```ts
export const MEMBERSHIP_OWNER_ONBOARDING_EVENT =
  "membership.owner_onboarding.requested.v1" as const;
```

For this event require tenantId, invitationId, userId, `purpose === "initial_owner_onboarding"`, and template `initial_owner_onboarding`.

Decrypt the AES-GCM plaintext as:

```ts
{
  activationToken: string;
  invitationToken: string;
}
```

and validate both against the existing one-time-token pattern.

- [ ] **Step 4: Render the single onboarding email**

The worker constructs:

```text
Subject: Set up your Booking OS workspace

You've been invited to set up your workspace on Booking OS.

Set your password to activate your account, then you'll review your workspace invitation.

https://<hostname>/activate#activation=<encoded activation>&invitation=<encoded invitation>

This link expires in 24 hours.
```

Do not log the rendered URL.

- [ ] **Step 5: Run worker suite and verify GREEN**

```bash
pnpm --filter @booking-os/worker-critical test
pnpm --filter @booking-os/worker-critical typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/worker-critical/src
git commit -m "feat: deliver owner onboarding email"
```

---

### Task 3: Return server-derived continuation email after owner-linked activation

**Files:**
- Modify: `apps/api/src/modules/identity/application/ports/identity-repository.port.ts`
- Modify: `apps/api/src/modules/identity/application/use-cases/complete-activation.ts`
- Test: `apps/api/src/modules/identity/application/use-cases/complete-activation.test.ts`
- Modify: `apps/api/src/modules/identity/infrastructure/persistence/prisma/prisma-identity-repository.adapter.ts`
- Test: corresponding Prisma identity repository tests
- Modify: `apps/api/src/modules/identity/infrastructure/http/identity-public.controller.ts`
- Test: identity public controller tests / `apps/api/test/identity-routing.e2e.test.ts`

**Interfaces:**
- `consumeActivationToken` returns the activated user plus activation invitation context.
- `CompleteActivationResult` becomes `{ userId: string; continuationEmail?: string }`.
- HTTP response remains `{ completed: true }` normally and becomes `{ completed: true, continuationEmail }` only for a token tied to a `tenant_owner` invitation.

- [ ] **Step 1: Add failing use-case/controller tests**

Owner-linked tenant activation:

```ts
assert.deepEqual(result, {
  userId: USER_ID,
  continuationEmail: "owner@example.test",
});
```

Platform activation and non-owner activation:

```ts
assert.deepEqual(result, { userId: USER_ID });
```

- [ ] **Step 2: Run focused identity tests and verify RED**

```bash
pnpm --filter @booking-os/api test -- complete-activation.test.ts identity-public.controller.test.ts
```

- [ ] **Step 3: Preserve invitation context in the repository result**

Extend the locked activation row with `invitationId`. When present, resolve only the invitation's `intendedRoleKey` needed for continuation classification. Return a frozen result carrying `user`, `invitationId`, and `intendedRoleKey` without importing memberships application code into Identity.

- [ ] **Step 4: Expose minimal continuation metadata**

Only when `scopeType === "tenant"`, `invitationId !== null`, and `intendedRoleKey === "tenant_owner"`, return `continuationEmail: user.normalizedEmail`. Do not return invitation token/id.

- [ ] **Step 5: Run identity unit/E2E tests and verify GREEN**

```bash
pnpm --filter @booking-os/api test -- complete-activation.test.ts
pnpm --filter @booking-os/api test:e2e -- identity-routing.e2e.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/identity apps/api/test/identity-routing.e2e.test.ts
git commit -m "feat: return owner activation continuation"
```

---

### Task 4: Orchestrate activation → normal login → explicit invitation review in the web console

**Files:**
- Modify: `apps/web-console/src/lib/identity/fragment-token.ts`
- Test: fragment-token tests
- Modify: `apps/web-console/src/components/identity/activation-form.tsx`
- Create: `apps/web-console/src/components/identity/owner-onboarding-activation-form.tsx` if keeping the generic password form unchanged is cleaner
- Modify minimally: `apps/web-console/src/components/identity/password-command-form.tsx` only if a success callback is needed
- Test: `apps/web-console/src/components/identity/identity-forms.test.tsx`
- Modify: `apps/web-console/src/components/session/login-form.tsx`
- Test: `apps/web-console/src/components/session/login-form.test.tsx`
- Modify copy only if needed: `apps/web-console/app/activate/page.tsx`
- Test: `apps/web-console/app/identity-app-router.test.ts`

**Interfaces:**
- Add strict fragment consumer for exactly `activation` + `invitation` keys; it strips history before parsing network work.
- Activation POST may return optional `continuationEmail` from Task 3.
- Normal `/api/auth/login` remains the only way to establish the pending session.

- [ ] **Step 1: Add failing fragment and component tests**

Strict onboarding fragment:

```text
#activation=<token>&invitation=<token>
```

must be accepted; duplicates, unknown keys, empty values, or partial pairs return null after history stripping.

Component happy path must assert calls in order:

```text
POST /api/auth/activation/complete
POST /api/auth/login
window.location.assign('/invite/accept#token=<invitation>')
```

and must assert no invitation acceptance POST occurs automatically.

- [ ] **Step 2: Run web-console tests and verify RED**

```bash
pnpm --filter @booking-os/web-console test -- identity-forms.test.tsx login-form.test.tsx
```

- [ ] **Step 3: Implement onboarding activation state machine**

Keep the password in component memory only. After activation returns `continuationEmail`, call the existing login BFF with that email/password. On success navigate to `/invite/accept#token=<invitation>`.

On activation-success/login-failure show:

```text
Your account is active, but we couldn't sign you in automatically.
```

with `Try again` and `Continue to sign in`.

- [ ] **Step 4: Add login continuation support**

`/login#invitation=<token>` must consume and strip the fragment immediately and retain it only in component memory. After successful normal login, route to `/invite/accept#token=<token>`; without the fragment, preserve existing login behavior.

- [ ] **Step 5: Run web-console suite and verify GREEN**

```bash
pnpm --filter @booking-os/web-console test
pnpm --filter @booking-os/web-console typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-console
git commit -m "feat: continue owner onboarding after activation"
```

---

### Task 5: Prove the complete one-email vertical slice and run protected verification

**Files:**
- Modify: `e2e/tenant-provisioning.spec.ts`
- Modify where identity-email integration fixtures assert supported events.
- Update relevant identity-access feature/runbook only if current behavior documentation explicitly describes the two-email owner journey.

**Interfaces:**
- End-to-end result: one pending-owner email → activation → pending login session → explicit accept → active owner/tenant.

- [ ] **Step 1: Add failing browser/integration assertions**

Assert a new owner provisioning dispatches one onboarding message, the onboarding link reaches activation, activation creates a normal password credential and pending tenant session, and `Accept invitation` remains a user click.

- [ ] **Step 2: Run focused E2E and verify RED/GREEN around the final integration**

```bash
pnpm --filter @booking-os/api test:e2e -- platform-tenant-provisioning.e2e.test.ts invitation-acceptance.e2e.test.ts
pnpm --filter @booking-os/worker-critical test
pnpm --filter @booking-os/web-console test
pnpm test:e2e -- tenant-provisioning.spec.ts
```

- [ ] **Step 3: Run repository verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:api
pnpm build
pnpm test:e2e
pnpm verify:identity-access
pnpm verify:foundation
```

Expected: all GREEN. Do not claim completion from focused tests alone.

- [ ] **Step 4: Commit any final test/docs reconciliation**

```bash
git add e2e docs apps packages
git commit -m "test: verify single-email owner onboarding"
```

- [ ] **Step 5: Open a draft PR to `main`**

PR summary must state the preserved security boundaries, TDD evidence, focused verification, full verification status, and explicitly note that tenant-admin invitations remain unchanged.
