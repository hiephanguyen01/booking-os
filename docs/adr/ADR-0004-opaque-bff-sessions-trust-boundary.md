---
id: ADR-0004
title: Opaque BFF Sessions and Browser Trust Boundary
status: accepted
owner: hiephanguyen01
date: 2026-08-04
---

# Opaque BFF Sessions and Browser Trust Boundary

## Context

The storefront and console run in browsers, while the API performs tenant- and partner-scoped business operations. Browser storage is exposed to script execution and must not become the authority for access tokens or tenant scope.

## Problem

Giving the browser a reusable API access token or accepting tenant scope directly from browser input would increase token theft, confused-deputy, and cross-tenant authorization risks.

## Options Considered

1. Store API bearer tokens in browser storage and call the API directly.
2. Use a browser-facing BFF with an HTTP-only cookie and opaque server-side session.
3. Put complete authorization claims in a long-lived browser cookie.

## Decision

Use the trust boundary Browser → BFF → API. The browser receives an HTTP-only, secure session cookie containing an opaque identifier. The BFF resolves session state server-side and forwards authenticated requests to the API.

Tenant and partner scope are derived from trusted server-side session and authorization data. Browser-provided identifiers may select among already-authorized resources, but they never establish authority by themselves.

## Trade-offs

The BFF adds a server hop and session lifecycle responsibilities. It avoids exposing reusable API credentials to browser JavaScript and centralizes cookie, CSRF, forwarding, and scope derivation policy.

## Consequences

Browser code must not persist API access tokens. Session issuance, rotation, expiration, logout, and CSRF protection remain server concerns. API endpoints require authenticated server context for protected operations and reject client-asserted scope that is not independently authorized.

## Validation

Foundation tests cover opaque session creation, HTTP-only cookie behavior, CSRF checks, expiration, and BFF-to-API forwarding boundaries. Security review verifies that tenant and partner scope are derived server-side.

## References

- `docs/superpowers/specs/2026-08-04-booking-os-pilot-design.md`
- `docs/superpowers/plans/2026-08-04-booking-os-pilot-foundation.md`
- `docs/runbooks/foundation-recovery.md`
