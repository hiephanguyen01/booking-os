---
id: PATTERN-0003
title: Host-Bound Opaque Session
status: active
owner: sessions
date: 2026-08-14
---

# Host-Bound Opaque Session

## Problem

A reusable browser identity kernel must prevent session material from becoming a portable bearer credential. If a cookie or refresh token can be replayed across platform/tenant hosts, if tenant scope comes from a client-selected value, or if stale role snapshots remain valid after a security mutation, browser compromise can cross authorization boundaries even when individual endpoints look protected.

## Context

Apply this pattern to Booking OS browser-authenticated Platform and Tenant scopes and extend the same invariants when later Customer or Partner scopes are added. It complements, rather than replaces, tenant FORCE RLS and resource policies.

The pattern assumes a server/BFF-oriented browser where API access tokens are not persisted in client JavaScript storage.

## Solution

### Opaque server-side session

Store only opaque session material in the browser and keep authoritative session/security state on the server. Persist token selectors and keyed digests instead of raw serialized tokens. Never render raw activation, reset, invitation, refresh, or session token material into page content, logs, audit metadata, or durable queue payloads outside the approved encrypted envelope boundary.

### Exact host and scope binding

Bind issued session/token purpose to the normalized trusted hostname and explicit scope (`platform`, `tenant`, or restricted pending subject). A request cannot change authority through body, query, or arbitrary headers. Wrong-host or wrong-scope replay is rejected before protected use-case execution.

### Browser cookie contract

Use a Secure, host-only cookie named with the `__Host-` prefix, Path `/`, and no Domain attribute. State-changing browser requests require the approved Origin and CSRF proof. Failed authentication must not mint the session cookie.

### Rotation and reuse detection

Rotate refresh/session material at the security boundary. A valid refresh replaces prior material atomically. Reuse of superseded refresh material is treated as compromise and revokes the affected session family rather than silently accepting another rotation.

### Authoritative authorization snapshot

A validated session carries authorization-version snapshots, not self-contained permanent permission authority. Before protected logic, rebuild/reconcile against current active user, membership, roles, permission catalog, scope, and resource/grant policy. Permission-only changes refresh the snapshot and rotate session material; inactive/suspended/revoked subjects revoke affected authority.

### Tenant execution boundary

After session/authorization validation, tenant operations enter the trusted tenant transaction with immutable actor/session/authorization context. PostgreSQL FORCE RLS remains the final isolation layer. Session host binding is not a substitute for RLS.

### Browser leakage controls

Auth responses use no-store protections and restrictive security headers. Fragment-carried one-time material is scrubbed before normal rendering. Redirect targets are same-origin/allowlisted. Logs and audit events use safe bounded context instead of raw cookies, headers, credentials, tokens, or complete payloads.

## Trade-offs

- Exact-host binding deliberately prevents a session from following the user between Platform and Tenant hosts; a new scoped session/elevation is required.
- Server-side state and rotation require transactional persistence and more database work than a stateless bearer token.
- Incident handling can invalidate more than one request when a token family is revoked, but that containment is intentional.
- BFF/server ownership of session state simplifies browser exposure at the cost of coupling browser authentication to server availability.
- Authorization-version reconciliation adds request-path work, but removes stale self-contained role authority and makes security mutations converge safely.

## Review Checklist

- [x] Browser code does not persist an API access token.
- [x] Session/token purpose is bound to normalized trusted host and explicit scope.
- [x] `__Host-` cookie constraints are preserved and failed login does not mint a session.
- [x] State-changing browser requests require approved Origin and CSRF proof.
- [x] Client body/query/arbitrary headers cannot establish tenant or authorization authority.
- [x] Raw token material is not persisted, logged, audited, or rendered outside approved encrypted delivery boundaries.
- [x] Rotation is atomic and refresh reuse revokes the affected session family.
- [x] Authorization versions are reconciled before protected use-case execution.
- [x] Suspended/revoked/inactive subjects lose affected session authority.
- [x] Tenant execution uses immutable actor/session/authorization context and FORCE RLS.
- [x] Auth/cache/redirect/logging protections are covered by API and browser regression tests.
- [x] `S1B-AC01` through `S1B-AC15` remain protected by the identity-access CI gate.
