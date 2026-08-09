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

The resumed login flow exposed the same TLS-termination mismatch in the
session BFF: its trusted browser target still comes from the internal HTTP
request URL. Session login, refresh, logout, and authenticated mutations will
derive the public host and protocol with the same validated forwarded-protocol
strategy used by identity and membership BFFs. Existing cross-origin rejection
and secure-cookie sanitization remain unchanged.

## Pending-session and identity follow-up

The next live checkpoint exposed three additional contract mismatches:

1. A valid existing-user invitation reaches the pending-session branch, but
   that branch snapshots `authorizationVersion: 0`. PostgreSQL deliberately
   requires positive authorization and session versions, and the security
   contract says sessions snapshot the global user's authorization version.
   After invitation eligibility succeeds, the membership-aware subject adapter
   will read the current active user authorization version and use that positive
   value. If the user no longer has a current version, login fails closed.
2. Activation and password-reset forms currently declare every command as
   platform-scoped. Tenant activation links contain only a fragment token, so a
   browser cannot authoritatively supply a tenant ID. The API HTTP boundary will
   instead derive identity scope from the already-resolved request context: an
   exact platform hostname produces platform scope, and a resolved tenant host
   produces tenant scope with its authoritative tenant ID. Unknown hosts fail
   closed. `TenantResolutionMiddleware` is applied to the public identity
   controller so tenant hosts populate that request context, without adding
   `SessionAuthMiddleware` to these public endpoints. Browser command bodies
   contain only email, or token and password; client-supplied scope fields do
   not select authorization scope.
3. The pre-auth CSRF service verifies tokens for 15 minutes but passes
   `maxAge: 900` to Express, which interprets the value as milliseconds and
   serializes `Max-Age=0`. The cookie option will use `900_000` milliseconds so
   the transport lifetime matches the cryptographic lifetime; the real HTTP
   response must serialize `Max-Age=900` seconds.

Each correction receives a test-first regression at the boundary that failed:
pending-subject resolution, authoritative identity command construction, and
the actual Nest/Express `Set-Cookie` header.

## Scope

No changes to Caddy configuration, API allowed origins, the authenticated
session-cookie policy, or token cryptography are included. In addition to
public-origin derivation, the live-flow follow-up extends the already-defined
owner invitation event contract and provisioning status response/UI, aligns
pending-session authorization snapshots with the database invariant, derives
public identity scope from authoritative host context, and corrects the
pre-auth CSRF cookie lifetime unit.
