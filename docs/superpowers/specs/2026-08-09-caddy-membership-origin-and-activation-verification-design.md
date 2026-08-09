# Caddy membership origin and activation verification

## Purpose

Restore the platform tenant-bootstrap flow when the web console runs behind the
local Caddy HTTPS proxy, and make the activation success UI explicitly covered
by a regression test.

## Observed behaviour

The platform admin can sign in through
`https://platform.booking.localhost`, but submitting the create-tenant form
returns `ORIGIN_NOT_ALLOWED`. The request is forwarded from Caddy to the
host-running Next server over HTTP; `membership-bff.ts` currently derives the
expected browser origin from that internal request URL. The browser sends an
HTTPS origin, so the same-origin check rejects a valid request before the API
is called.

The activation command completed in the API: the account is active, its
password credential exists, and the activation audit event was recorded. The
existing identity BFF already resolves its public origin using the forwarded
protocol. The activation UI must therefore first receive a focused regression
test for its successful HTTP response; no production change is justified until
that test or a repeat of the real flow demonstrates a defect.

## Design

### Membership BFF

Replace the internal-URL-only target derivation with a small local helper that
uses the request `Host` and a validated first `X-Forwarded-Proto` value
(`http` or `https`), falling back to the request URL protocol. Return both the
canonical public origin and public host from this helper.

All existing membership handlers continue using this target for the browser
origin check and `x-forwarded-host` passed upstream. This preserves rejection
of an absent, malformed, or cross-site `Origin`; it only recognises the public
HTTPS scheme supplied by the trusted local proxy.

### Tests

Add a membership BFF regression test using an internal loopback HTTP request,
public platform host, browser HTTPS origin, and `x-forwarded-proto: https`.
It must reach the CSRF handshake and platform-provisioning upstream request.

Add an identity form test that receives HTTP 200 from activation and asserts
the success message is displayed. It protects the client-side completion state
without changing activation production behaviour.

## Verification

Run the focused web-console tests, typecheck the console package, and rerun
the browser flow: create `acme-studio`, inspect provisioning status and the
owner email. Continue only as far as a separately confirmed password-change
submission permits.

## Scope

No changes to Caddy configuration, API allowed origins, session cookie policy,
or identity token handling are included. This work modifies only public-origin
derivation in the membership BFF and adds regression coverage.
