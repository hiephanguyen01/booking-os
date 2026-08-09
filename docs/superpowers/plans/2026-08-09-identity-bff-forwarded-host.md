# Identity BFF Forwarded-Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the browser hostname across the identity BFF so host-bound activation tokens complete through the local HTTPS topology.

**Architecture:** The identity BFF derives the browser origin and host from the incoming Next.js request, then forwards the host as `x-forwarded-host` to both the pre-auth CSRF handshake and the completion request. The existing API `TRUST_PROXY=true` setting derives the original browser hostname from that header.

**Tech Stack:** TypeScript, Next.js route handlers, Node.js `node:test`, pnpm.

## Global Constraints

- Preserve the generic browser response; do not expose upstream identity errors or security material.
- Derive the forwarded hostname only from `request.url`, never from browser-supplied headers.
- Forward the same hostname on both requests in each identity command flow.
- Do not change token, CSRF, database, or API controller behavior.
- Work directly on `main` with explicit user approval.

---

### Task 1: Forward the trusted browser host in identity BFF calls

**Files:**
- Modify: `apps/web-console/src/lib/identity/identity-bff.test.ts`
- Modify: `apps/web-console/src/lib/identity/identity-bff.ts`

**Interfaces:**
- Consumes: `Request.url`, which represents the trusted browser-facing console URL.
- Produces: `x-forwarded-host` on the upstream `GET /auth/csrf` and the upstream identity `POST`.

- [ ] **Step 1: Write the failing regression assertion**

In the activation test, use a browser request URL of
`https://platform.booking.localhost/api/auth/activation/complete` and assert
that both captured upstream request headers contain the literal
`x-forwarded-host: platform.booking.localhost`.

The production change that this test catches is removal or omission of the
hostname header from either the CSRF call or the activation completion call.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
pnpm --filter @booking-os/web-console exec node --test --import tsx src/lib/identity/identity-bff.test.ts
```

Expected: FAIL because the upstream headers do not contain
`x-forwarded-host`.

- [ ] **Step 3: Add the minimal forwarding implementation**

In `createIdentityBffHandlers`, derive `new URL(request.url).host` once per
identity command. Include the value as `x-forwarded-host` in the headers for
the CSRF GET and the upstream POST, keeping the current origin and cookie
handling intact.

- [ ] **Step 4: Run focused test to verify GREEN**

Run:

```bash
pnpm --filter @booking-os/web-console exec node --test --import tsx src/lib/identity/identity-bff.test.ts
```

Expected: all identity-BFF tests pass.

- [ ] **Step 5: Run affected package verification**

Run:

```bash
pnpm --filter @booking-os/web-console typecheck
pnpm --filter @booking-os/web-console test
```

Expected: both commands exit 0.

- [ ] **Step 6: Manually verify the regression boundary**

With the local API, console, and HTTPS proxy running, request a fresh platform
activation link and submit a valid password on
`https://platform.booking.localhost/activate#token=...`. Expected: the API
receives `platform.booking.localhost`, consumes the token, and the UI shows
the success message.

- [ ] **Step 7: Commit the implementation**

```bash
git add apps/web-console/src/lib/identity/identity-bff.ts apps/web-console/src/lib/identity/identity-bff.test.ts docs/superpowers/plans/2026-08-09-identity-bff-forwarded-host.md
git commit -m "fix(console): preserve identity browser hostname"
```
