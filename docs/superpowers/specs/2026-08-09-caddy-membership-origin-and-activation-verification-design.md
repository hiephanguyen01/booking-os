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

## Live-flow follow-up

The first live run exposed two additional blockers that must be corrected
before invitation testing can continue:

1. Platform provisioning emits `membership.owner_invitation.requested.v1`,
   while the critical worker only treats the tenant-admin invitation event as
   an identity-email job. The owner event payload must carry the user and role
   fields required by its authenticated envelope, and the worker must parse,
   retry, decrypt, and send that event as a membership invitation.
2. Tenant provisioning stores the display name but omits it from the status
   response and UI. The query/DTO/client contract will expose it as
   `tenantName`, and the status component will render both tenant name and
   slug.

Both corrections require test-first regressions at their API, worker, and UI
boundaries. Existing cross-origin, token-envelope, and retry protections stay
unchanged.

## Scope

No changes to Caddy configuration, API allowed origins, session cookie policy,
or token cryptography are included. In addition to public-origin derivation,
the live-flow follow-up extends the already-defined owner invitation event
contract and the provisioning status response/UI.
