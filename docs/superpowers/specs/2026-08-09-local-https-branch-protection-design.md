# Local HTTPS and Main Branch Protection Design

## Status

Approved design, self-reviewed and ready for implementation planning.

## Context

Booking OS now has real platform and tenant authentication, host-bound tenant resolution, secure opaque sessions, session-bound CSRF, invitation acceptance, membership administration, and browser vertical slices. The current local console is still reached directly over HTTP on port 3002. That is sufficient for literal loopback origins, but realistic tenant hosts such as `acme-studio.booking.localhost` must use HTTPS to preserve the API's existing exact-origin and secure-cookie rules.

The repository also currently has no enforced protection on `main`. The existing CI, architecture, Sprint 0, and identity-email workflows run successfully, but GitHub does not currently prevent direct pushes, force pushes, branch deletion, or merging without those checks.

This design closes both gaps without weakening authorization, CSRF, cookies, hostname trust, or tenant RLS.

## Goals

1. Add opt-in local HTTPS for `platform.booking.localhost` and `*.booking.localhost` with Docker Compose and Caddy.
2. Preserve host-bound tenant resolution and exact-origin CSRF.
3. Keep API and web-console development processes on the host at ports 3001 and 3002.
4. Make local CA trust repeatable and documented.
5. Document platform and tenant browser testing from bootstrap through membership management.
6. Define and, when supported by the connected GitHub capability, apply a safe `main` protection policy.
7. Update stale documentation that still describes the console as a demo/mock session shell.

## Non-goals

- No production TLS configuration.
- No wildcard CSRF origins.
- No relaxation of `SESSION_ALLOWED_ORIGINS` validation.
- No request body/query/header tenant override.
- No proxy exposure for PostgreSQL, Redis, MinIO, Mailpit, or the API.
- No API/web-console containerization.
- No required positive PR approval count yet; solo development remains supported.
- No Sprint 1B.4 authorization-hardening work in this change.

## Selected approach

Use Caddy under an opt-in Docker Compose profile named `https`.

Pin local Caddy to version `2.11.3` through `.env.docker`. Caddy publishes host ports 80/443, terminates local TLS with `tls internal`, and reverse proxies browser traffic to the host-running web-console on port 3002. Caddy data/config are persisted in named volumes so the local CA remains stable across ordinary restarts.

Normal `pnpm infra:up` must not start Caddy. Developers opt in only when they need full tenant-browser testing.

## Architecture

### Platform request flow

```text
Browser
  -> https://platform.booking.localhost
  -> Caddy :443
  -> host web-console :3002
  -> Next.js BFF
  -> http://127.0.0.1:3001/api
  -> x-forwarded-host=platform.booking.localhost
  -> platform scope
```

### Tenant request flow

```text
Browser
  -> https://acme-studio.booking.localhost
  -> Caddy :443
  -> host web-console :3002
  -> Next.js BFF
  -> http://127.0.0.1:3001/api
  -> x-forwarded-host=acme-studio.booking.localhost
  -> tenant resolver validates booking.localhost suffix/domain mapping
  -> tenant authorization + RLS
```

The browser never calls the API directly. The BFF remains responsible for browser-facing session handling, CSRF forwarding, safe response propagation, and preserving the browser host.

## Hostname model

Use:

```dotenv
TENANT_BASE_DOMAIN=booking.localhost
PLATFORM_HOSTNAME=platform.booking.localhost
```

Tenant hosts are:

```text
<tenant-slug>.booking.localhost
```

No per-tenant hosts-file entry should be required in the supported local setup. HTTPS is supplied by Caddy rather than by adding insecure HTTP exceptions to the API.

## Caddy and Compose design

Add `CADDY_VERSION=2.11.3` to `.env.docker.example` and add a `caddy` service to `compose.yaml` with:

- profile `https`;
- image `caddy:${CADDY_VERSION}`;
- host ports 80 and 443;
- read-only repository Caddyfile mount;
- named `caddy_data` and `caddy_config` volumes;
- `host.docker.internal:host-gateway` in `extra_hosts` for Linux compatibility;
- normal local restart behavior.

The Caddyfile covers:

```text
platform.booking.localhost
*.booking.localhost
```

Both host classes use:

```text
reverse_proxy host.docker.internal:3002
tls internal
```

The original browser Host header must be preserved. No Caddy rule may synthesize or override tenant identity.

The implementation must also ensure the host-running Next.js console is reachable from the Docker container. If the current Next.js dev command does not bind a Docker-reachable host interface on a supported platform, change only the development binding needed to make port 3002 reachable; do not alter browser hostname semantics.

Add explicit repository scripts:

```text
infra:https:up
infra:https:logs
infra:https:down
```

They must reuse `.env.docker` and the existing Compose file/profile rather than create a second orchestration stack.

## Local CA trust

Caddy `tls internal` creates a local CA. Because Caddy runs in Docker, automatic installation into the workstation trust store must not be assumed.

The runbook must provide exact macOS, Windows, and Linux instructions to copy/export the Caddy root certificate from the persisted Caddy data and trust that public root certificate on the workstation. The private CA key must never leave the Caddy data volume and must never be committed.

A destructive infrastructure reset may remove the Caddy data volume, after which the newly generated root CA must be trusted again.

## Environment configuration

### API

Recommended HTTPS browser configuration:

```dotenv
NODE_ENV=development
HOST=127.0.0.1
TRUST_PROXY=true
TENANT_BASE_DOMAIN=booking.localhost
PLATFORM_HOSTNAME=platform.booking.localhost
PORT=3001
API_PREFIX=api
DATABASE_URL=postgresql://booking:booking@127.0.0.1:5432/booking_os
REDIS_URL=redis://127.0.0.1:6379/0
SESSION_ALLOWED_ORIGINS=https://platform.booking.localhost,https://acme-studio.booking.localhost
PAYMENT_PROVIDER=mock
```

Identity security values continue to come from the local API environment template and remain explicitly non-production.

`SESSION_ALLOWED_ORIGINS` remains an exact allowlist. Developers add only the tenant HTTPS origins they actively test. Wildcard origin matching is out of scope.

The API reads its environment during process bootstrap, so changing `SESSION_ALLOWED_ORIGINS`, `TENANT_BASE_DOMAIN`, `PLATFORM_HOSTNAME`, or related API configuration requires restarting the API process.

### Web console

The console continues to talk to the API over loopback HTTP:

```dotenv
API_BASE_URL=http://127.0.0.1:3001/api
APP_LOCALE=vi
```

Caddy is only the browser-facing TLS terminator and reverse proxy.

### Critical worker

The critical worker remains structurally unchanged. Documentation must require:

- the same identity envelope keyring as the API;
- PostgreSQL access for outbox polling;
- Redis access;
- Mailpit SMTP for local identity email delivery.

## Local browser workflow

1. Start normal local infrastructure.
2. Start API, web-console, and critical worker on the host.
3. Start the opt-in `https` Compose profile.
4. Trust Caddy's local root CA once.
5. Configure `SESSION_ALLOWED_ORIGINS` with `https://platform.booking.localhost` and restart API.
6. Bootstrap the platform administrator with hostname `platform.booking.localhost`.
7. Use Mailpit to open the activation token at `https://platform.booking.localhost/activate#token=...`.
8. Log in at `https://platform.booking.localhost/login`.
9. Create a tenant from the platform console.
10. Add `https://<tenant>.booking.localhost` to `SESSION_ALLOWED_ORIGINS` and restart API.
11. Open the tenant invitation at `https://<tenant>.booking.localhost/invite/accept#token=...`.
12. Exercise `/settings/members` under the same HTTPS tenant host.

## Security invariants

Implementation must preserve:

- hostname-only tenant identity;
- controlled use of `TRUST_PROXY=true` for the BFF-to-API path;
- same-origin browser mutations;
- exact canonical HTTPS `SESSION_ALLOWED_ORIGINS` for tenant hosts;
- no wildcard CSRF origin support;
- Secure, HttpOnly, host-only `__Host-booking_session` with Path `/`;
- fragment-only activation/reset/invitation secrets;
- no committed certificate/private-key material;
- existing RLS/FORCE RLS boundaries;
- explicitly local-only credentials and identity keys.

## Main branch protection target

Desired `main` policy:

- require changes through pull requests;
- require status checks before merge;
- require the branch to be up to date before merge;
- block force pushes;
- block branch deletion;
- require zero positive approvals for now;
- do not bypass checks for documentation-only changes.

Required checks must be selected from the actual current check-run names produced by these stable workflows:

- CI;
- API architecture boundaries;
- Sprint 0 gates;
- Identity email integration.

Implementation must inspect a current successful run and use the actual check names exposed by GitHub rather than guessing context strings from workflow filenames.

The currently connected GitHub capability does not expose a branch-protection mutation action. Therefore this work must not claim protection was programmatically applied through the connector. The implementation must provide exact GitHub repository-settings steps for the owner to apply the policy, and then verify the resulting branch state if it becomes visible through the connector.

## Documentation changes

Update README and add or update a focused local-development runbook covering:

- real console login/session behavior;
- normal infrastructure startup;
- opt-in HTTPS startup;
- local CA trust and reset behavior;
- API/web-console/worker env files;
- platform admin bootstrap;
- activation through Mailpit;
- tenant provisioning;
- exact-origin tenant configuration;
- invitation acceptance and membership testing;
- automated web-console/Playwright tests;
- troubleshooting without disabling security controls.

HTTP-only development and full HTTPS tenant-browser testing must be clearly separated.

## Error handling and diagnostics

The setup must fail visibly or document a direct diagnostic when:

- ports 80/443 are occupied;
- web-console is unreachable from Caddy on port 3002;
- the Caddy root CA is untrusted;
- the current platform/tenant origin is absent from `SESSION_ALLOWED_ORIGINS`;
- API tenant/base-domain configuration is inconsistent;
- tenant hostname resolution finds no active tenant/domain mapping.

Troubleshooting must direct developers to Caddy logs, web-console logs, API health/readiness, Mailpit, and environment configuration. It must never recommend disabling TLS validation, CSRF, secure-cookie attributes, tenant resolution, or RLS.

## Testing and verification

Implementation verification includes:

1. Compose config validation with and without the `https` profile.
2. A Caddy configuration validation/check that does not commit certificates.
3. Existing format, frontend-boundary, lint, typecheck, architecture, unit, API E2E, RLS, migration, build, production-config, dependency-audit, and secret-scan gates.
4. Existing Playwright suite with unchanged security semantics.
5. Documentation command review against actual scripts and env schemas.
6. Verification that ordinary `pnpm infra:up` excludes Caddy.
7. Verification that the explicit HTTPS command includes Caddy.
8. Branch-protection state verification after the repository owner applies the documented settings.

CI does not need to trust the local Caddy CA unless a dedicated test explicitly provisions and cleans up that trust in the runner.

## Rollback

The HTTPS change is additive. Stop the `https` profile to return to direct HTTP development. Removing the Caddy service, scripts, volumes, and documentation restores the prior topology without a database migration.

Branch protection is independently reversible in GitHub repository settings for emergency maintenance.

## Acceptance criteria

- `pnpm infra:up` does not start Caddy.
- An explicit HTTPS command starts Caddy on 80/443.
- `https://platform.booking.localhost` reaches the host web-console.
- `https://<tenant>.booking.localhost` reaches the same web-console while preserving tenant hostname through the BFF to API.
- Platform activation/login/tenant creation can be exercised over HTTPS.
- A configured tenant HTTPS origin can exercise invitation/membership flows without relaxing CSRF/cookie policy.
- No certificate or private key is committed.
- README/runbook matches real identity/session/membership behavior.
- All existing repository gates remain green.
- GitHub protection instructions are exact and the connector limitation is stated truthfully until the owner applies them.
