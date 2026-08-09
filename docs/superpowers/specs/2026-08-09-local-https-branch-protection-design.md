# Local HTTPS and Main Branch Protection Design

## Status

Approved design for implementation.

## Context

Booking OS now has real platform and tenant authentication, session cookies, host-bound tenant resolution, session-bound CSRF, invitation acceptance, membership administration, and browser vertical slices. The current local developer setup still exposes the Next.js console directly over HTTP on port 3002. That is sufficient for platform flows on loopback origins, but it is not sufficient for realistic tenant-subdomain mutations because the API intentionally accepts plain HTTP only for literal loopback hostnames while tenant hosts such as `acme-studio.booking.localhost` are non-loopback origins.

The repository also currently has no enforced protection on `main`. CI, architecture, Sprint 0, and identity-email workflows run and pass, but GitHub does not currently prevent direct pushes, force pushes, branch deletion, or merging a PR that has not satisfied those checks.

This design closes both operational gaps without weakening the existing authorization, CSRF, cookie, or hostname invariants.

## Goals

1. Provide an opt-in local HTTPS entry point for `platform.booking.localhost` and `*.booking.localhost` using Docker Compose and Caddy.
2. Preserve the existing host-bound tenant model and exact-origin CSRF model.
3. Keep the existing application development processes on the host: API on port 3001 and web-console on port 3002.
4. Make the certificate bootstrap and trust procedure explicit and repeatable for developers.
5. Document a safe local environment for platform and tenant browser testing.
6. Define the desired `main` branch protection policy and apply it when the connected GitHub capability supports branch-protection mutation.
7. Update repository documentation so it no longer describes the console as a mock/demo session shell.

## Non-goals

- Do not terminate production TLS with this Caddy configuration.
- Do not add wildcard CSRF origins or relax `SESSION_ALLOWED_ORIGINS` validation.
- Do not allow arbitrary request headers, query parameters, or request bodies to establish tenant identity.
- Do not expose PostgreSQL, Redis, MinIO, Mailpit, or the API itself through the HTTPS proxy.
- Do not containerize the API or web-console as part of this work.
- Do not require PR approval count greater than zero; the repository currently supports a solo-development workflow.
- Do not change Sprint 1B authorization semantics or begin Plan 4 authorization hardening in this change.

## Selected approach

Use Caddy as an opt-in Docker Compose profile named `https`.

Caddy will publish host ports 80 and 443 and reverse proxy local browser traffic to the host-running web-console on port 3002. It will issue local certificates with Caddy's internal CA and persist the Caddy data/config directories in named volumes.

Normal infrastructure commands remain unchanged for developers who do not need tenant browser testing. HTTPS is started explicitly through a dedicated repository script or Compose profile invocation.

## Architecture

### Request flow

Platform browser flow:

```text
Browser
  -> https://platform.booking.localhost
  -> Caddy :443
  -> host web-console :3002
  -> Next.js BFF
  -> http://127.0.0.1:3001/api
  -> API trusts the BFF-provided x-forwarded-host because TRUST_PROXY=true
  -> platform scope
```

Tenant browser flow:

```text
Browser
  -> https://acme-studio.booking.localhost
  -> Caddy :443
  -> host web-console :3002
  -> Next.js BFF
  -> http://127.0.0.1:3001/api
  -> x-forwarded-host=acme-studio.booking.localhost
  -> tenant resolver validates suffix against booking.localhost
  -> tenant-scoped authorization and RLS
```

The browser never needs direct network access to the API. The BFF remains the browser-facing boundary for session handling, CSRF forwarding, safe response propagation, and host preservation.

### Local hostname model

Use:

```text
TENANT_BASE_DOMAIN=booking.localhost
PLATFORM_HOSTNAME=platform.booking.localhost
```

Tenant hosts are therefore:

```text
<tenant-slug>.booking.localhost
```

The `.localhost` special-use suffix is intentionally retained because modern browsers and operating systems resolve it to loopback without requiring per-tenant hosts-file entries. Caddy supplies HTTPS so the API's exact-origin policy does not need to treat tenant hostnames as insecure HTTP exceptions.

### Caddy routing

Caddy receives both the platform hostname and wildcard tenant hosts and forwards all requests to the host-running web-console.

The configuration must preserve the original browser Host header. No rule may synthesize tenant identity separately from the incoming host.

The container reaches the host development server through `host.docker.internal`. Linux compatibility must be provided with Compose `extra_hosts` mapping to `host-gateway`.

### TLS

Use Caddy `tls internal` for local certificates.

Caddy data is persisted so its local root CA remains stable across normal container restarts. Developers trust the generated Caddy root CA once on their workstation. `infra:reset` may remove that CA if the Caddy data volume is included in the destructive reset, so the documentation must explain that trust may need to be repeated after a full reset.

No certificate files are committed to the repository.

## Compose design

Add a `caddy` service to `compose.yaml` with:

- profile: `https`
- pinned Caddy image version from `.env.docker`
- ports 80 and 443
- read-only Caddyfile mount
- named `caddy_data` and `caddy_config` volumes
- `host.docker.internal:host-gateway` compatibility mapping
- restart policy suitable for local development

Existing `pnpm infra:up` behavior must not start Caddy automatically.

Add explicit scripts such as:

```text
infra:https:up
infra:https:logs
infra:https:down
```

The exact script implementation should reuse `.env.docker` and the existing Compose file rather than introduce a second orchestration stack.

## Caddy configuration

The Caddyfile will cover:

```text
platform.booking.localhost
*.booking.localhost
```

Both host classes reverse proxy to:

```text
host.docker.internal:3002
```

Both use:

```text
tls internal
```

No proxy route is added for the API, PostgreSQL, Redis, Mailpit, or MinIO.

## Environment configuration

### API

Recommended local browser configuration:

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

Identity security values remain copied from the current local API environment template and must still be replaced outside local development.

`SESSION_ALLOWED_ORIGINS` remains an exact allowlist. Developers add only tenant origins they are actively testing. This design deliberately does not introduce wildcard origin matching.

### Web console

The web-console continues to run on port 3002 and talks to the API using loopback HTTP:

```dotenv
API_BASE_URL=http://127.0.0.1:3001/api
APP_LOCALE=vi
```

Caddy is only a browser-facing TLS terminator and reverse proxy.

### Critical worker

The critical worker remains unchanged except that documentation must continue to require:

- the same identity envelope keyring as the API;
- PostgreSQL access for outbox polling;
- Redis access;
- Mailpit SMTP for local identity email delivery.

## Local browser workflow

1. Start PostgreSQL, Redis, MinIO, and Mailpit with the normal infrastructure command.
2. Start the API, web-console, and critical worker on the host.
3. Start the opt-in HTTPS Caddy profile.
4. Trust Caddy's local root CA once.
5. Bootstrap the platform administrator with hostname `platform.booking.localhost`.
6. Open Mailpit and consume the activation token by navigating to the HTTPS platform host while preserving the fragment token.
7. Log in at `https://platform.booking.localhost/login`.
8. Create a tenant from the platform console.
9. Add that tenant's exact HTTPS origin to `SESSION_ALLOWED_ORIGINS` before testing authenticated tenant mutations, then restart the API if required by the current environment-loading model.
10. Open the invitation link on `https://<tenant>.booking.localhost/invite/accept#token=...` and test membership administration under the same HTTPS tenant host.

## Security invariants

The implementation must preserve all of the following:

- tenant identity is derived only from the effective hostname;
- `TRUST_PROXY=true` is appropriate only because the API is reached through the controlled local BFF path;
- browser mutations remain same-origin;
- `SESSION_ALLOWED_ORIGINS` remains exact, canonical, and HTTPS for tenant hosts;
- no wildcard CSRF origin support is added;
- the `__Host-booking_session` cookie remains Secure, HttpOnly, host-only, and Path `/`;
- invitation/activation/reset secrets remain fragment-only in browser navigation;
- the Caddy internal CA private key is never committed;
- local development keys and credentials remain explicitly non-production.

## Main branch protection target

The desired `main` policy is:

- require changes through pull requests;
- require status checks before merge;
- require the branch to be up to date before merge;
- block force pushes;
- block branch deletion;
- do not require a positive approval count yet;
- do not bypass checks merely because the change is documentation-only.

Required checks should correspond to the stable repository workflows that protect the current baseline:

- CI
- API architecture boundaries
- Sprint 0 gates
- Identity email integration

When selecting required checks in GitHub, use the actual check-run names exposed by the repository rather than guessing strings from workflow filenames. Verification must inspect a current successful run before applying the protection policy.

If the connected GitHub tool cannot mutate branch-protection settings, implementation must record that limitation explicitly and provide exact repository-settings steps instead of claiming the policy was applied.

## Documentation changes

Update README and/or a focused runbook to document:

- the console now has real identity/session flows rather than a demonstration session;
- normal local infrastructure startup;
- opt-in local HTTPS startup;
- Caddy CA trust procedure;
- API/web-console/worker environment files;
- platform admin bootstrap;
- activation through Mailpit;
- platform tenant creation;
- exact-origin tenant configuration;
- invitation acceptance and membership testing;
- cleanup/reset behavior;
- automated web-console and Playwright test commands.

Documentation should clearly separate normal HTTP development from full HTTPS tenant-browser testing.

## Error handling and developer diagnostics

The HTTPS setup must fail visibly when:

- ports 80 or 443 are already occupied;
- web-console is not reachable on host port 3002;
- the local CA is not trusted;
- API exact-origin configuration does not contain the current platform or tenant origin;
- the API is not using the expected tenant base domain;
- a tenant hostname does not resolve to an active tenant/domain record.

Troubleshooting documentation should point developers to Caddy logs, web-console logs, API readiness, Mailpit, and the relevant environment variables. It must not recommend disabling TLS validation, CSRF, tenant resolution, RLS, or secure-cookie attributes as a workaround.

## Testing and verification

Implementation verification will include:

1. Compose configuration validation with the HTTPS profile enabled.
2. Existing formatting, lint, frontend-boundary, typecheck, architecture, unit, API E2E, RLS, migration, build, production-config, dependency-audit, and secret-scan gates.
3. Existing Playwright suite unchanged in security semantics.
4. A focused configuration check for the Caddyfile/Compose HTTPS profile where practical without committing certificates.
5. Documentation command review against actual package scripts and environment schemas.
6. GitHub branch-protection state verification after applying the policy, or an explicit recorded connector limitation if mutation is unavailable.

The local HTTPS feature must not require CI runners to trust the Caddy local CA unless a dedicated test specifically provisions and removes that trust within the test environment.

## Rollback

The change is operationally additive. Developers can stop the `https` profile and continue using the existing direct HTTP ports. Removing the Caddy service, its profile scripts, and documentation restores the previous topology without data migration.

Branch protection is independently reversible through repository settings if it interferes with emergency repository maintenance.

## Acceptance criteria

The design is complete when:

- normal `pnpm infra:up` does not start Caddy;
- an explicit HTTPS command starts Caddy on ports 80/443;
- `https://platform.booking.localhost` reaches the host web-console;
- `https://<tenant>.booking.localhost` reaches the same web-console while preserving the tenant hostname through the BFF to the API;
- platform activation/login/tenant creation can be manually exercised over HTTPS;
- a configured tenant origin can exercise invitation and membership flows without relaxing CSRF or cookie policy;
- no certificate/private key material is committed;
- README/runbook matches the real session and membership behavior;
- all existing repository gates remain green;
- `main` protection is applied if supported by the connected GitHub capability, otherwise the exact unapplied step is documented truthfully.
