# Task 7: Honor public HTTPS origin in session BFF

## Implementation

- `trustedBrowserTarget` now derives the canonical browser target from the request `Host` (falling back to the request URL host) and the first `x-forwarded-proto` value only when it is exactly `http` or `https`. All other values fall back to the request URL protocol.
- The canonical target is constructed with `new URL`, preserving the existing session API-base validation, same-origin rejection, CSRF flow, and session-cookie sanitization.
- Browser-provided `x-forwarded-host` remains untrusted and is not used to derive the target.

## Regression coverage

Added a Caddy login regression with an internal HTTP request URL, public `Host: platform.booking.localhost`, browser `Origin: https://platform.booking.localhost`, and `X-Forwarded-Proto: https`. It verifies HTTP 200, the CSRF-plus-login upstream calls, and the public HTTPS origin and host forwarded upstream.

## TDD evidence

The regression was run before the production change with:

```sh
pnpm --filter @booking-os/web-console test -- session-bff-forwarded-host.test.ts
```

It failed as expected with `403 !== 200` at the new Caddy login assertion. After the implementation, the focused session suite and typecheck passed:

```sh
pnpm --filter @booking-os/web-console test -- session-bff-forwarded-host.test.ts session-bff.test.ts
pnpm --filter @booking-os/web-console typecheck
```

The session command completed with 60 Node tests and 14 Vitest tests passing; typecheck completed successfully.

## Fixture migration

Three existing session fixtures had explicitly supplied `Host: attacker.example.test` while asserting the URL host. That describes the prior URL-derived contract and conflicts with the approved Caddy contract, which trusts the request `Host`. The fixtures now supply the canonical `Host: console.example.test` and retain hostile `x-forwarded-host` values, preserving the spoofing check that inbound forwarded host is ignored.
