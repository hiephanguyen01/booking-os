# Identity BFF Forwarded-Host Design

## Status

Approved for implementation on 2026-08-09.

## Context

Platform activation tokens are cryptographically bound to the hostname supplied
when the token is issued. In local HTTPS development, that hostname is
`platform.booking.localhost`.

The web console's identity BFF sends server-side requests to the loopback API
at `http://127.0.0.1:3001/api`. Unlike the existing session and membership
BFFs, it does not forward the trusted browser host. The API consequently sees
the loopback hostname for the CSRF handshake and activation completion,
derives a loopback-bound token purpose, and rejects the valid platform token.

## Goal

Preserve the exact browser hostname across the identity BFF's CSRF handshake
and completion request so host-bound activation and password-reset tokens work
in the supported local HTTPS topology.

## Non-goals

- Do not change token formats, token expiry, database records, or token binding.
- Do not accept a hostname from request bodies or untrusted client headers.
- Do not expose API error details, token values, or CSRF proof material to the browser.
- Do not change session or membership BFF behavior.

## Selected approach

Derive the browser target from the trusted incoming Next.js `Request` URL in
`identity-bff.ts`, as the session and membership BFFs already do. Send its
`host` as `x-forwarded-host` on both upstream identity requests:

1. `GET /auth/csrf?purpose=...`
2. the matching completion or password-forgot `POST`

The API already runs with `TRUST_PROXY=true` in the local HTTPS runbook, so
Express uses this BFF-set header as the request hostname. The CSRF handshake
and token completion then use the same hostname that was bound into the token.

## Data flow

```text
Browser: https://platform.booking.localhost/activate#token=...
  -> Caddy
  -> Next.js identity BFF
  -> GET http://127.0.0.1:3001/api/auth/csrf
       x-forwarded-host: platform.booking.localhost
  -> POST http://127.0.0.1:3001/api/auth/activation/complete
       x-forwarded-host: platform.booking.localhost
  -> API validates CSRF and token against platform.booking.localhost
```

## Verification

Extend the identity-BFF unit tests to assert `x-forwarded-host` equals the
host from the BFF request URL on both upstream calls. This test must fail
before the production change and pass after it. Run the focused web-console
test and the affected API identity tests after the implementation.
