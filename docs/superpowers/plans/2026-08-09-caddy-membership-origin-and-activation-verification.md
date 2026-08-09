# Caddy Membership Origin and Activation Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept valid HTTPS membership mutations through local Caddy while retaining origin protection, and protect activation success feedback with regression coverage.

**Architecture:** Membership BFF derives its public target from `Host` and validated `X-Forwarded-Proto`, matching the identity BFF. Tests cover this proxy boundary; activation receives only a success-state test because its backend completion already works.

**Tech Stack:** Next.js, TypeScript, Node test runner, Vitest, Testing Library, pnpm.

## Global Constraints

- Accept only `http` or `https` from the first `X-Forwarded-Proto` value; otherwise use the request URL protocol.
- Reject absent, malformed, or cross-site browser origins before upstream requests.
- Do not change Caddy, API allowed origins, token handling, or session cookie policy.
- Write and observe a failing membership regression test before production behavior changes.

---

## File Structure

- Modify `apps/web-console/src/lib/membership/membership-bff.ts`: public browser target derivation.
- Modify `apps/web-console/src/lib/membership/membership-bff.test.ts`: Caddy TLS-termination regression.
- Modify `apps/web-console/src/components/identity/identity-forms.test.tsx`: activation success UI assertion.

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
