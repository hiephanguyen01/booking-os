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
