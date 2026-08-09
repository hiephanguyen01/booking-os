# Caddy Membership Origin and Activation Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the local HTTPS tenant onboarding flow while retaining origin, scope, session-version, and CSRF protections at every browser/API boundary.

**Architecture:** Browser BFFs derive their public target from `Host` and validated `X-Forwarded-Proto`. Pending sessions snapshot the active user's positive authorization version, public identity commands derive scope from the API's resolved host context, and the pre-auth cookie lifetime matches its 15-minute cryptographic proof. Tests cover each live-failing boundary before implementation.

**Tech Stack:** Next.js, TypeScript, Node test runner, Vitest, Testing Library, pnpm.

## Global Constraints

- Accept only `http` or `https` from the first `X-Forwarded-Proto` value; otherwise use the request URL protocol.
- Reject absent, malformed, or cross-site browser origins before upstream requests.
- Do not change Caddy, API allowed origins, authenticated session-cookie policy, or token cryptography.
- Write and observe a failing membership regression test before production behavior changes.
- Pending invitation sessions must use the current positive `User.authorizationVersion`; `0` is invalid.
- Public identity scope comes only from the exact platform hostname or resolved tenant request context, never from browser-supplied scope fields.
- Pre-auth CSRF proof and cookie lifetimes are both 15 minutes: Express receives `900_000` milliseconds and emits `Max-Age=900` seconds.

---

## File Structure

- Modify `apps/web-console/src/lib/membership/membership-bff.ts`: public browser target derivation.
- Modify `apps/web-console/src/lib/membership/membership-bff.test.ts`: Caddy TLS-termination regression.
- Modify `apps/web-console/src/components/identity/identity-forms.test.tsx`: activation success UI assertion.
- Modify `apps/api/src/modules/sessions/infrastructure/membership/membership-aware-session-subject.adapter.ts`: positive pending-session authorization snapshot.
- Modify `apps/api/src/modules/identity/infrastructure/http/identity-public.controller.ts`: request-derived identity command scope.
- Modify `apps/api/src/modules/identity/infrastructure/http/identity-public.nest.controller.ts`: authoritative platform/tenant scope resolution.
- Modify identity form components and tests: omit browser-supplied scope fields.
- Modify `apps/api/src/modules/identity/infrastructure/http/pre-auth-csrf.ts`: Express millisecond cookie lifetime.

### Task 1: Preserve public HTTPS origin in membership BFF

**Files:**

- Modify: `apps/web-console/src/lib/membership/membership-bff.ts:60-62`
- Modify: `apps/web-console/src/lib/membership/membership-bff.test.ts:66-112`

**Interfaces:**

- Consumes: a `Request` with `host`, `origin`, and optional `x-forwarded-proto` headers.
- Produces: `browserTarget(request): { readonly origin: string; readonly host: string }` for validation and upstream host forwarding.

- [ ] **Step 1: Write the failing proxy-boundary test**

Add a `createPlatformTenant` test to `membership-bff.test.ts` that creates a request with all of the following values:

```ts
new Request("http://127.0.0.1:3002/api/platform/tenants", {
  method: "POST",
  headers: {
    cookie: `__Host-booking_session=${encodeURIComponent(createSessionToken())}`,
    "content-type": "application/json",
    host: "platform.booking.localhost",
    origin: "https://platform.booking.localhost",
    "x-forwarded-proto": "https",
  },
  body: JSON.stringify({
    slug: "acme-studio",
    tenantName: "Acme Studio",
    ownerEmail: "owner@example.test",
  }),
})
```

Mock the first fetch as `Response.json({ csrfToken: "fresh-proof" })` and the second as a successful provisioning response. Assert `response.status === 200`, two upstream calls, and `x-forwarded-host === "platform.booking.localhost"` on the mutation.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm --filter @booking-os/web-console test -- membership-bff.test.ts
```

Expected: the new test fails with status `403` because the current target uses the internal HTTP URL.

- [ ] **Step 3: Implement minimal target derivation**

Replace `browserTarget` with:

```ts
function browserTarget(request: Request): { readonly origin: string; readonly host: string } {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.trim() || requestUrl.host;
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;
  return { origin: new URL(`${protocol}//${host}`).origin, host };
}
```

- [ ] **Step 4: Run focused membership suite to verify GREEN**

```bash
pnpm --filter @booking-os/web-console test -- membership-bff.test.ts
```

Expected: all membership BFF tests pass.

- [ ] **Step 5: Commit the task**

```bash
git add apps/web-console/src/lib/membership/membership-bff.ts apps/web-console/src/lib/membership/membership-bff.test.ts
git commit -m "fix(console): honor forwarded HTTPS origin for memberships"
```

### Task 2: Lock in activation success UI behavior

**Files:**

- Modify: `apps/web-console/src/components/identity/identity-forms.test.tsx:31-55`

**Interfaces:**

- Consumes: `ActivationForm` with an HTTP 200 completion response.
- Produces: visible `status` copy `Your account has been activated.`.

- [ ] **Step 1: Add the success-state assertion**

At the end of `submits only activation command fields and removes the fragment`, add:

```ts
expect((await screen.findByRole("status")).textContent).toContain(
  "Your account has been activated.",
);
```

- [ ] **Step 2: Run the focused test**

```bash
pnpm --filter @booking-os/web-console test -- identity-forms.test.tsx
```

Expected: PASS, establishing the existing HTTP 200 success contract without production-code changes.

- [ ] **Step 3: Commit the task**

```bash
git add apps/web-console/src/components/identity/identity-forms.test.tsx
git commit -m "test(console): cover activation success feedback"
```

### Task 3: Verify source and browser flow

**Files:**

- Verify only: `apps/web-console/src/lib/membership/membership-bff.ts`
- Verify only: `apps/web-console/src/components/identity/identity-forms.test.tsx`

**Interfaces:**

- Consumes: platform admin session and `https://platform.booking.localhost/platform/create`.
- Produces: a provisioned `acme-studio` status page and owner email in Mailpit.

- [ ] **Step 1: Run regression suites**

```bash
pnpm --filter @booking-os/web-console test -- membership-bff.test.ts identity-forms.test.tsx
pnpm --filter @booking-os/web-console typecheck
```

Expected: both commands exit 0.

- [ ] **Step 2: Repeat platform tenant creation through Caddy**

Submit `acme-studio`, `Acme Studio`, and `owner@example.test` at the authenticated platform form.

Expected: `/platform/status?tenantId=...` shows `Acme Studio`, `acme-studio`, and `provisioning`; no `ORIGIN_NOT_ALLOWED` occurs.

- [ ] **Step 3: Verify owner delivery**

Open Mailpit and locate the message to `owner@example.test`.

Expected: activation and/or invitation URL uses `https://acme-studio.booking.localhost` and contains a fragment token.

### Task 4: Dispatch platform owner invitation email

**Files:**

- Modify: `apps/api/src/modules/memberships/application/use-cases/platform-tenant-provisioning.workflow.ts`
- Modify: `apps/api/src/modules/memberships/application/use-cases/platform-tenant-provisioning.pending-activation.workflow.test.ts`
- Modify: `apps/api/src/modules/memberships/application/use-cases/platform-tenant-provisioning.workflow.test.ts`
- Modify: `apps/worker-critical/src/identity-email/identity-email-event.ts`
- Modify: `apps/worker-critical/src/identity-email/sensitive-envelope.ts`
- Modify: `apps/worker-critical/src/identity-email/membership-invitation-email.test.ts`
- Modify: `apps/worker-critical/src/outbox/outbox-dispatcher.ts`
- Modify: `apps/worker-critical/src/outbox/outbox-dispatcher.test.ts`

**Interfaces:**

- Consumes: `membership.owner_invitation.requested.v1` with membership envelope AAD bound to tenant, invitation, user, host, recipient, and `tenant_owner`.
- Produces: retryable BullMQ identity-email job and fragment-only tenant invitation email.

- [ ] **Step 1: Write failing worker and API event-contract tests**

Add an owner variant to `membership-invitation-email.test.ts` whose event type is
`membership.owner_invitation.requested.v1`, payload role is `tenant_owner`, and
whose encrypted AAD uses those exact values. Assert dispatch sends
`https://acme.example.com/invite/accept#token=...`.

Extend `outbox-dispatcher.test.ts` so an owner invitation event receives five
attempts, exponential 1,000 ms backoff, and `removeOnComplete: true`.

Extend initial and resend workflow assertions so the owner event payload contains:

```ts
userId: ownerIdentity.userId,
intendedRoleKey: "tenant_owner",
```

- [ ] **Step 2: Run tests to verify RED**

```bash
pnpm --filter @booking-os/worker-critical test -- membership-invitation-email.test.ts outbox-dispatcher.test.ts
pnpm --filter @booking-os/api test -- platform-tenant-provisioning.pending-activation.workflow.test.ts platform-tenant-provisioning.workflow.test.ts
```

Expected: owner email parsing/dispatch and payload assertions fail before implementation.

- [ ] **Step 3: Implement the owner event contract**

Add `MEMBERSHIP_OWNER_INVITATION_EVENT` to the worker email event union. Parse
both membership invitation event types as `membership_invitation`, require the
role matching the event (`tenant_admin` or `tenant_owner`), and authenticate
the envelope using the existing membership-email AAD layout. Treat both event
types as retryable identity email jobs in the outbox dispatcher.

Add `userId` and `intendedRoleKey: "tenant_owner"` to both owner invitation
payload creation paths in the platform provisioning workflow. Do not change
the encrypted envelope format.

- [ ] **Step 4: Verify GREEN and full relevant suites**

```bash
pnpm --filter @booking-os/worker-critical test
pnpm --filter @booking-os/api test -- platform-tenant-provisioning.pending-activation.workflow.test.ts platform-tenant-provisioning.workflow.test.ts
```

Expected: both commands exit 0 with pristine output.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/memberships/application/use-cases/platform-tenant-provisioning.workflow.ts apps/api/src/modules/memberships/application/use-cases/platform-tenant-provisioning.pending-activation.workflow.test.ts apps/api/src/modules/memberships/application/use-cases/platform-tenant-provisioning.workflow.test.ts apps/worker-critical/src/identity-email/identity-email-event.ts apps/worker-critical/src/identity-email/sensitive-envelope.ts apps/worker-critical/src/identity-email/membership-invitation-email.test.ts apps/worker-critical/src/outbox/outbox-dispatcher.ts apps/worker-critical/src/outbox/outbox-dispatcher.test.ts
git commit -m "fix(identity): deliver platform owner invitations"
```

### Task 5: Show tenant name in provisioning status

**Files:**

- Modify: `apps/api/src/modules/memberships/application/ports/platform-tenant-provisioning-workflow.port.ts`
- Modify: `apps/api/src/modules/memberships/infrastructure/persistence/prisma/prisma-platform-tenant-provisioning-query.adapter.ts`
- Modify: `apps/api/src/modules/memberships/infrastructure/http/platform-tenants.dto.ts`
- Modify: `apps/api/src/modules/memberships/application/use-cases/get-tenant-provisioning.use-case.test.ts`
- Modify: `apps/web-console/components/tenant-provisioning-status.tsx`
- Create: `apps/web-console/components/tenant-provisioning-status.test.tsx`

**Interfaces:**

- Produces: provisioning JSON field `tenantName: string` and visible tenant name plus slug.

- [ ] **Step 1: Write failing API and UI tests**

Change the get-provisioning expectation to include `tenantName: "Acme Studio"`.
Add a component test that mocks a successful status response containing
`tenantName: "Acme Studio"` and asserts both `Acme Studio` and `acme-studio`
are rendered.

- [ ] **Step 2: Run tests to verify RED**

```bash
pnpm --filter @booking-os/api test -- get-tenant-provisioning.use-case.test.ts
pnpm --filter @booking-os/web-console test -- tenant-provisioning-status.test.tsx
```

Expected: API result and UI name assertions fail before implementation.

- [ ] **Step 3: Implement the response/UI field**

Add `tenantName` to the provisioning result type and Swagger DTO, map it from
`tenant.name` in the Prisma query, add it to the client status interface, and
render the name as the primary Tenant value with the slug shown separately.

- [ ] **Step 4: Verify GREEN and typecheck**

```bash
pnpm --filter @booking-os/api test -- get-tenant-provisioning.use-case.test.ts
pnpm --filter @booking-os/web-console test -- tenant-provisioning-status.test.tsx
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/web-console typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/memberships/application/ports/platform-tenant-provisioning-workflow.port.ts apps/api/src/modules/memberships/infrastructure/persistence/prisma/prisma-platform-tenant-provisioning-query.adapter.ts apps/api/src/modules/memberships/infrastructure/http/platform-tenants.dto.ts apps/api/src/modules/memberships/application/use-cases/get-tenant-provisioning.use-case.test.ts apps/web-console/components/tenant-provisioning-status.tsx apps/web-console/components/tenant-provisioning-status.test.tsx
git commit -m "fix(console): show tenant provisioning name"
```

### Task 6: Resume live business verification

**Files:** Verify only.

- [ ] **Step 1:** Restart or allow watch-mode reload of API, console, and critical worker, then verify health/readiness.
- [ ] **Step 2:** Reissue the pending owner invitation through the platform API or create a fresh verification tenant; do not expose token values.
- [ ] **Step 3:** Verify Mailpit has both the owner activation (when needed) and tenant-host invitation email.
- [ ] **Step 4:** Continue activation, invitation acceptance, member management, authorization boundaries, and final-owner invariant, pausing before each new password submission unless the user has confirmed it.

### Task 7: Honor public HTTPS origin in session BFF

**Files:**

- Modify: `apps/web-console/src/lib/session/session-bff.ts`
- Modify: `apps/web-console/src/lib/session/session-bff-forwarded-host.test.ts`

**Interfaces:**

- Consumes: an internal HTTP Next request with public `Host`, browser HTTPS `Origin`, and `X-Forwarded-Proto: https`.
- Produces: trusted browser `{ origin, host }` used by login, CSRF, refresh, logout, and session mutations.

- [ ] **Step 1: Write the failing Caddy login regression**

Add a test that sends `http://127.0.0.1:3002/api/auth/login` with headers
`host: platform.booking.localhost`, `origin: https://platform.booking.localhost`,
and `x-forwarded-proto: https`. Assert HTTP 200, two upstream calls,
`x-forwarded-host: platform.booking.localhost`, and upstream login
`origin: https://platform.booking.localhost`.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/web-console test -- session-bff-forwarded-host.test.ts
```

Expected: new test returns 403 before implementation.

- [ ] **Step 3: Implement minimal trusted target derivation**

Use the request `Host` (falling back to URL host), accept only the first
forwarded protocol value when it is exactly `http` or `https`, otherwise fall
back to URL protocol, then canonicalize with `new URL`. Do not trust
`x-forwarded-host` from the browser.

- [ ] **Step 4: Verify GREEN and session suite**

```bash
pnpm --filter @booking-os/web-console test -- session-bff-forwarded-host.test.ts session-bff.test.ts
pnpm --filter @booking-os/web-console typecheck
```

Expected: commands exit 0 and existing cross-origin tests remain green.

- [ ] **Step 5: Commit**

```bash
git add apps/web-console/src/lib/session/session-bff.ts apps/web-console/src/lib/session/session-bff-forwarded-host.test.ts
git commit -m "fix(console): honor forwarded HTTPS origin for sessions"
```

### Task 8: Continue owner/admin/security live flow

**Files:** Verify only.

- [ ] **Step 1:** Login platform admin through Caddy, verify the existing `acme-studio` status page shows name, slug, and provisioning.
- [ ] **Step 2:** Reissue the pending owner invitation through the authorized application endpoint and verify Mailpit contains tenant-host activation/invitation links with fragment-only tokens.
- [ ] **Step 3:** Pause for confirmation immediately before submitting `OwnerDev123!`; after confirmation, activate/login owner and accept the invitation once, then verify single-use.
- [ ] **Step 4:** Invite and activate `admin2@example.test`, pausing for confirmation before submitting `Admin2Dev123!`.
- [ ] **Step 5:** Verify member roles, authorization boundaries, owner controls, last-owner invariant, logout/reset/session behavior, and automated test checkpoints from the attached checklist. Do not inspect browser cookie storage; infer session correctness from application behavior and API contracts.

### Task 9: Persist a valid pending-session authorization version

**Files:**

- Modify: `apps/api/src/modules/sessions/infrastructure/membership/membership-aware-session-subject.adapter.ts`
- Modify: `apps/api/src/modules/sessions/infrastructure/membership/membership-aware-session-subject.adapter.test.ts`
- Modify: `apps/api/src/modules/sessions/sessions.module.test.ts`

**Interfaces:**

- Consumes: `SessionSubjectPort.currentAuthorizationVersion(userId): Promise<number | null>` after a tenant invitation is proven eligible.
- Produces: `{ state: "invitation_pending", authorizationVersion: positiveUserVersion }`, or `null` when the user version is unavailable.

- [ ] **Step 1: Write the failing pending-subject regressions**

Change the eligible invitation test so the active-subject double returns user
authorization version `7` and assert:

```ts
assert.deepEqual(result, { state: "invitation_pending", authorizationVersion: 7 });
assert.deepEqual(harness.active.versionCalls, [USER_ID]);
```

Add a second case with `authorizationVersion = null` and assert the adapter
returns `null`. Update the AppModule composition test to expect the positive
version returned by its real subject provider instead of `0`.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- membership-aware-session-subject.adapter.test.ts sessions.module.test.ts
```

Expected: current production returns `authorizationVersion: 0` and does not
consult the current user version.

- [ ] **Step 3: Implement the minimal fail-closed snapshot**

After pending invitation eligibility succeeds, call
`activeSubjects.currentAuthorizationVersion(input.userId)`. Return `null` when
the result is `null` or not a positive integer; otherwise return the pending
subject with that exact version. Do not relax the database constraint.

- [ ] **Step 4: Verify GREEN and typecheck**

```bash
pnpm --filter @booking-os/api test -- membership-aware-session-subject.adapter.test.ts sessions.module.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/sessions/infrastructure/membership/membership-aware-session-subject.adapter.ts apps/api/src/modules/sessions/infrastructure/membership/membership-aware-session-subject.adapter.test.ts apps/api/src/modules/sessions/sessions.module.test.ts
git commit -m "fix(api): persist valid pending session versions"
```

### Task 10: Derive public identity scope from authoritative host context

**Files:**

- Modify: `apps/api/src/modules/identity/infrastructure/http/identity-public.controller.ts`
- Modify: `apps/api/src/modules/identity/infrastructure/http/identity-public.controller.test.ts`
- Modify: `apps/api/src/modules/identity/infrastructure/http/identity-public.nest.controller.ts`
- Modify: `apps/api/src/modules/identity/infrastructure/http/identity-public.nest.controller.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/identity-routing.e2e.test.ts`
- Modify: `apps/web-console/src/components/identity/forgot-password-form.tsx`
- Modify: `apps/web-console/src/components/identity/password-command-form.tsx`
- Modify: `apps/web-console/src/components/identity/identity-forms.test.tsx`
- Regenerate: `packages/contracts/openapi/openapi.json`
- Regenerate: `packages/api-client/src/generated/schema.ts`
- Regenerate: `packages/api-client/src/generated/client.ts`

**Interfaces:**

- Produces on `IdentityPublicHttpRequest`:

```ts
readonly scope:
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string };
```

- Consumes: exact effective hostname, `EnvironmentService.platformHostname`, and optional `RequestContext.tenantId` populated by `TenantResolutionMiddleware` on the public identity controller. These routes remain public and do not receive `SessionAuthMiddleware`.
- Browser request bodies contain `{ email }` or `{ token, newPassword }`; scope fields cannot select the command scope.

- [ ] **Step 1: Write failing API and form regressions**

In the core controller test, create a tenant-scoped request and assert activation,
forgot-password, and reset executors receive:

```ts
scopeType: "tenant",
tenantId: "11111111-1111-4111-8111-111111111111",
```

even when an extra browser body field claims `scopeType: "platform"`.

In the Nest controller test, assert exact platform host resolves platform scope,
a request context with `tenantId` resolves tenant scope, and an unknown host with
no tenant context throws before reaching the core controller.

In `identity-routing.e2e.test.ts`, send a public identity command through a
tenant hostname and assert the command receives tenant scope with the tenant ID
resolved by middleware. This is the composition regression proving the real
route supplies authoritative tenant context; it must not require a session.

In `identity-forms.test.tsx`, assert activation, forgot-password, and reset
payloads omit both `scopeType` and `tenantId`.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- identity-public.controller.test.ts identity-public.nest.controller.test.ts
pnpm --filter @booking-os/web-console test -- identity-forms.test.tsx
```

Expected: commands fail because the core trusts body scope and the forms hardcode
platform scope.

- [ ] **Step 3: Implement authoritative scope resolution**

Add `scope` to `IdentityPublicHttpRequest`. At the Nest boundary, derive tenant
scope only from `RequestContextStorage.require().tenantId`; otherwise derive
platform scope only when the normalized effective hostname equals
`EnvironmentService.platformHostname`. Reject every unresolved non-platform
hostname. Build all three identity use-case commands from `request.scope` and
remove scope properties from the public body DTOs and browser form payloads.
Apply `TenantResolutionMiddleware` to `NestIdentityPublicController` in
`AppModule` without applying `SessionAuthMiddleware` to that controller.

- [ ] **Step 4: Verify GREEN, generated contracts, and typechecks**

```bash
pnpm --filter @booking-os/api test -- identity-public.controller.test.ts identity-public.nest.controller.test.ts
pnpm --filter @booking-os/api test:e2e -- identity-routing.e2e.test.ts
pnpm --filter @booking-os/web-console test -- identity-forms.test.tsx identity-bff.test.ts
pnpm api:generate
pnpm api:check-generated
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/web-console typecheck
```

Expected: all commands exit 0; generated request schemas no longer require
browser-supplied identity scope.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/identity/infrastructure/http/identity-public.controller.ts apps/api/src/modules/identity/infrastructure/http/identity-public.controller.test.ts apps/api/src/modules/identity/infrastructure/http/identity-public.nest.controller.ts apps/api/src/modules/identity/infrastructure/http/identity-public.nest.controller.test.ts apps/api/src/app.module.ts apps/api/test/identity-routing.e2e.test.ts apps/web-console/src/components/identity/forgot-password-form.tsx apps/web-console/src/components/identity/password-command-form.tsx apps/web-console/src/components/identity/identity-forms.test.tsx packages/contracts/openapi/openapi.json packages/api-client/src/generated/schema.ts packages/api-client/src/generated/client.ts
git commit -m "fix(identity): derive public scope from hostname"
```

### Task 11: Align the pre-auth CSRF cookie lifetime

**Files:**

- Modify: `apps/api/src/modules/identity/infrastructure/http/pre-auth-csrf.ts`
- Modify: `apps/api/src/modules/identity/infrastructure/http/pre-auth-csrf.test.ts`
- Modify: `apps/api/src/modules/identity/infrastructure/http/identity-public.controller.test.ts`
- Modify: `apps/api/test/identity-routing.e2e.test.ts`

**Interfaces:**

- Produces: Express cookie option `maxAge: 900_000` milliseconds and HTTP header attribute `Max-Age=900` seconds.
- Preserves: 15-minute token verification boundary and `Secure; HttpOnly; Path=/; SameSite=Strict`.

- [ ] **Step 1: Write the failing HTTP regression**

Extend `identity-routing.e2e.test.ts` to assert the real response cookie contains
all of:

```ts
assert.match(cookie, /; Max-Age=900;/u);
assert.match(cookie, /; Path=\//u);
assert.match(cookie, /; HttpOnly/u);
assert.match(cookie, /; Secure/u);
assert.match(cookie, /; SameSite=Strict/u);
```

Update the service/controller expected cookie option to the independently
derived millisecond value `15 * 60 * 1000`.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test:e2e -- identity-routing.e2e.test.ts
pnpm --filter @booking-os/api test -- pre-auth-csrf.test.ts identity-public.controller.test.ts
```

Expected: the HTTP assertion sees `Max-Age=0` and unit expectations see `900`.

- [ ] **Step 3: Implement the single unit correction**

Use the existing `CSRF_TTL_MS` constant as the cookie `maxAge` value and type the
option as `900_000`. Do not change signing, purpose binding, or verification.

- [ ] **Step 4: Verify GREEN and typecheck**

```bash
pnpm --filter @booking-os/api test:e2e -- identity-routing.e2e.test.ts
pnpm --filter @booking-os/api test -- pre-auth-csrf.test.ts identity-public.controller.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: all commands exit 0 and the real header emits `Max-Age=900`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/identity/infrastructure/http/pre-auth-csrf.ts apps/api/src/modules/identity/infrastructure/http/pre-auth-csrf.test.ts apps/api/src/modules/identity/infrastructure/http/identity-public.controller.test.ts apps/api/test/identity-routing.e2e.test.ts
git commit -m "fix(identity): align pre-auth csrf lifetime"
```

### Task 12: Resume owner/admin/security live flow

**Files:** Verify only.

- [ ] **Step 1:** Restart or reload API, verify health/readiness, and log in `owner@example.test` on `acme-studio` using the already-confirmed password.
- [ ] **Step 2:** Accept the still-pending owner invitation once, verify the second use fails, and confirm membership/role/tenant activation.
- [ ] **Step 3:** Invite `admin2@example.test`, verify tenant-host activation and invitation emails, and pause immediately before submitting `Admin2Dev123!` for fresh confirmation.
- [ ] **Step 4:** Complete the remaining authorization, final-owner, logout/reset/session, cross-tenant, hostname, TLS, automated-suite, and working-tree checkpoints from the attached checklist.

### Task 13: Compose protected tenant-membership routes

**Files:**

- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/membership-routing.e2e.test.ts`

**Interfaces:**

- `TenantMembershipsController` consumes `RequestContext.tenantId` from
  `TenantResolutionMiddleware`, then authenticated actor/session context from
  `SessionAuthMiddleware`.
- Middleware order is tenant resolution first, session authentication second,
  matching the existing protected tenant-invitation and session routes.
- `SessionRequired`, `SessionCsrfGuard`, authorization context, tenant
  isolation, membership policies, and final-owner rules remain unchanged.

- [ ] **Step 1: Write the failing AppModule HTTP regression**

Create `membership-routing.e2e.test.ts` around the real `AppModule`. Override
only external/readiness dependencies and the focused use cases needed to
observe composition. Send:

```http
GET /api/memberships
Host: studio.example.test
Cookie: __Host-booking_session=<valid opaque token>
```

Assert the tenant resolver supplies
`11111111-1111-4111-8111-111111111111`, the session resolver receives that
tenant scope and hostname, the authorization builder receives an active tenant
session context, and the list use case returns HTTP 200. Do not bypass the
production middleware or controller.

- [ ] **Step 2: Verify RED**

```bash
cd apps/api
node --test --test-concurrency=1 --import tsx test/membership-routing.e2e.test.ts
```

Expected: HTTP 401 because `TenantMembershipsController` has no tenant/session
middleware binding and the controller's `SessionRequired` guard fails closed.

- [ ] **Step 3: Implement the composition fix**

Import `TenantMembershipsController` in `AppModule` and add it to the existing
`TenantResolutionMiddleware, SessionAuthMiddleware` `forRoutes` binding.
Do not create a second middleware chain or change controller guards.

- [ ] **Step 4: Verify GREEN and typecheck**

```bash
cd apps/api
node --test --test-concurrency=1 --import tsx test/membership-routing.e2e.test.ts
cd ../..
pnpm --filter @booking-os/api typecheck
```

Expected: focused HTTP regression passes and API typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/test/membership-routing.e2e.test.ts
git commit -m "fix(api): authenticate tenant membership routes"
```
