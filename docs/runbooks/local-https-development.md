# Local HTTPS Development

Use this runbook when you need to exercise the real Booking OS platform and tenant browser flows over HTTPS. Normal direct-port development can continue without Caddy; the HTTPS profile is opt-in.

## Prerequisites

- Docker Desktop or Docker Engine with Docker Compose v2.
- Node.js 22 or newer within the repository-supported range.
- pnpm 10.34.5.
- Ports 80 and 443 available for the opt-in Caddy proxy.

## 1. Start local infrastructure

Create the Docker environment once:

```bash
cp .env.docker.example .env.docker
```

Start the normal services. Caddy is not part of this command because it is behind the `https` profile:

```bash
pnpm infra:up
pnpm infra:ps
```

This starts PostgreSQL, Redis, MinIO, and Mailpit using the existing local defaults.

## 2. Configure the API for HTTPS browser traffic

Create the API environment:

```bash
cp apps/api/.env.example apps/api/.env
```

Keep the local-only identity keys from the template and set the browser/tenant values below:

```dotenv
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

`SESSION_ALLOWED_ORIGINS` is an exact allowlist. `https://acme-studio.booking.localhost` is only an example tenant origin; replace it or append the exact HTTPS tenant origins you are actively testing. Do not use wildcard origins.

The API reads its environment during bootstrap. Restart the API after changing `SESSION_ALLOWED_ORIGINS`, `TENANT_BASE_DOMAIN`, or `PLATFORM_HOSTNAME`.

`TRUST_PROXY=true` is appropriate for this local topology because the controlled Next.js BFF forwards the original browser hostname to the host-running API. It is not permission to trust arbitrary public proxies.

## 3. Configure the web console

Create `apps/web-console/.env.local`:

```dotenv
API_BASE_URL=http://127.0.0.1:3001/api
APP_LOCALE=vi
```

The console continues to run on host port 3002. Caddy is only the browser-facing TLS terminator and reverse proxy.

## 4. Configure the critical worker and Mailpit

Create the worker environment:

```bash
cp apps/worker-critical/.env.example apps/worker-critical/.env
```

The worker must use the same `IDENTITY_ENVELOPE_KEYS` and `IDENTITY_ACTIVE_ENVELOPE_KEY_ID` as the API so it can decrypt identity-email envelopes. Add PostgreSQL access for outbox polling:

```dotenv
DATABASE_URL=postgresql://booking:booking@127.0.0.1:5432/booking_os
```

The existing worker template points SMTP to Mailpit on `127.0.0.1:1025` and Redis to `127.0.0.1:6379`.

## 5. Generate Prisma, migrate, and seed

Run once after infrastructure is healthy, and again whenever migrations or the generated Prisma client change:

```bash
pnpm --filter @booking-os/api prisma:generate
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm --filter @booking-os/api prisma:seed
```

## 6. Start the application processes

Use separate terminals so each process is easy to inspect.

API:

```bash
pnpm --filter @booking-os/api dev
```

Web console:

```bash
pnpm --filter @booking-os/web-console dev
```

Critical worker:

```bash
pnpm --filter @booking-os/worker-critical dev
```

Verify the API before adding TLS:

```bash
curl -i http://127.0.0.1:3001/api/health
curl -i http://127.0.0.1:3001/api/ready
```

## 7. Start the opt-in Caddy HTTPS proxy

Validate the profile and start only Caddy:

```bash
pnpm infra:https:config
pnpm infra:https:up
```

Caddy listens on host ports 80 and 443 and proxies these browser hosts to the host-running console on port 3002:

```text
https://platform.booking.localhost
https://<tenant-slug>.booking.localhost
```

The Caddy configuration does not proxy the API, PostgreSQL, Redis, MinIO, or Mailpit.

Inspect the proxy when troubleshooting:

```bash
pnpm infra:https:logs
```

## 8. Trust the Caddy local root CA once

Caddy uses `tls internal`. Export the root certificate from the persistent Caddy data volume:

```bash
docker compose --env-file .env.docker --profile https cp \
  caddy:/data/caddy/pki/authorities/local/root.crt \
  /tmp/booking-os-caddy-root.crt
```

### macOS

Trust the exported root certificate system-wide:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  /tmp/booking-os-caddy-root.crt
```

Restart the browser if it was already open.

### Linux

Copy `/tmp/booking-os-caddy-root.crt` into your distribution's local CA trust directory and run that distribution's CA update command. For Debian/Ubuntu this is typically `/usr/local/share/ca-certificates/` followed by `sudo update-ca-certificates`; other distributions use their own trust-store tooling.

Do not disable browser TLS verification as a workaround.

The Caddy CA is stored in the `caddy_data` volume, so normal Caddy/container restarts keep the same CA. `pnpm infra:reset` removes named volumes, including the Caddy CA, so a new CA may need to be exported and trusted afterward.

## 9. Bootstrap and activate the platform administrator

In `apps/api/.env`, enable the local bootstrap and set the administrator email, for example:

```dotenv
IDENTITY_BOOTSTRAP_ENABLED=true
IDENTITY_BOOTSTRAP_ADMIN_EMAIL=admin@example.test
```

Bootstrap against the real platform hostname:

```bash
pnpm --filter @booking-os/api identity:bootstrap-platform-admin -- \
  --hostname platform.booking.localhost
```

The critical worker consumes the outbox event and sends the activation email to Mailpit. Open:

```text
http://localhost:8025
```

Use the activation link on the HTTPS platform host:

```text
https://platform.booking.localhost/activate#token=<TOKEN>
```

Set the account password. The browser UI consumes the fragment token and removes it from the address bar before submitting the activation command.

## 10. Test the platform flow

Sign in at:

```text
https://platform.booking.localhost/login
```

Then create a tenant at:

```text
https://platform.booking.localhost/platform/create
```

Example values:

```text
Tenant slug: acme-studio
Tenant name: Acme Studio
Initial owner email: owner@example.test
```

After provisioning, inspect the status page and Mailpit. The tenant remains in provisioning until the initial owner completes the invitation flow.

## 11. Test the tenant invitation and membership flow

Before authenticated tenant mutations, ensure the exact tenant origin is present in the API environment:

```dotenv
SESSION_ALLOWED_ORIGINS=https://platform.booking.localhost,https://acme-studio.booking.localhost
```

Restart the API after changing the allowlist.

Open the tenant invitation link while preserving its fragment token:

```text
https://acme-studio.booking.localhost/invite/accept#token=<TOKEN>
```

After invitation acceptance, exercise membership administration at:

```text
https://acme-studio.booking.localhost/settings/members
```

The current membership vertical slice supports listing members, fixed `tenant_admin` invitations with a 24-hour expiry, suspension/revocation, and owner promotion/demotion subject to backend authorization and final-owner invariants.

## 12. Automated tests

Web-console unit/component/BFF tests:

```bash
pnpm --filter @booking-os/web-console test
```

Browser E2E suite:

```bash
pnpm test:e2e
```

Full foundation verification:

```bash
pnpm verify:foundation
```

Stop manually started API/web servers before `pnpm test:e2e` if you want Playwright to own the complete test-server environment rather than reuse an already-running local server.

## 13. Diagnostics

API liveness/readiness:

```bash
curl -i http://127.0.0.1:3001/api/health
curl -i http://127.0.0.1:3001/api/ready
```

Caddy logs:

```bash
pnpm infra:https:logs
```

Mailpit:

```text
http://localhost:8025
```

Common failures:

- **Port 80 or 443 already in use:** stop the conflicting local service or intentionally change `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT` in `.env.docker` and use the matching browser origin.
- **502 from Caddy:** verify `pnpm --filter @booking-os/web-console dev` is running and reachable on host port 3002.
- **Certificate warning:** export and trust the Caddy root CA; do not disable TLS verification.
- **403 origin/CSRF failure:** add the exact current HTTPS origin to `SESSION_ALLOWED_ORIGINS` and restart the API.
- **Wrong tenant scope or 404:** verify `TENANT_BASE_DOMAIN=booking.localhost`, the browser hostname, and that the tenant/domain record exists in an active/resolvable state.
- **Email not delivered:** inspect the critical-worker logs, Mailpit, Redis, database connectivity, and matching API/worker envelope keys.

Do not troubleshoot by disabling TLS validation, CSRF, tenant hostname resolution, RLS, or secure-cookie attributes.

## 14. Stop and reset

Stop only the HTTPS proxy:

```bash
pnpm infra:https:down
```

Stop the normal infrastructure while retaining named-volume data:

```bash
pnpm infra:down
```

Destructively reset all Compose volumes:

```bash
pnpm infra:reset
```

A full reset deletes PostgreSQL, Redis, MinIO, and Caddy named-volume data. Because it removes the Caddy internal CA, the next HTTPS startup can generate a new CA that must be trusted again.

## Direct HTTP versus full HTTPS development

Use the existing direct ports when you only need ordinary local development:

```text
API:     http://127.0.0.1:3001/api
Console: http://localhost:3002
```

Use the opt-in HTTPS profile when testing host-bound platform/tenant identity, Secure session cookies, invitation links, and authenticated tenant mutations end to end:

```text
Platform: https://platform.booking.localhost
Tenant:   https://<tenant-slug>.booking.localhost
```

The HTTPS topology is additive; it does not relax the production-oriented security invariants in the API or browser session layer.
