# Local HTTPS Caddy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Docker Compose Caddy profile that serves the host-running Booking OS web console over trusted local HTTPS at `platform.booking.localhost` and `*.booking.localhost`, while preserving exact-origin CSRF, host-derived tenant identity, and existing CI behavior.

**Architecture:** Caddy 2.11.3 runs only under Compose profile `https`, terminates browser TLS with `tls internal`, and reverse proxies to `host.docker.internal:3002`. The Next.js console and API continue running on the host; the BFF forwards the original browser host to the API, which runs with `TRUST_PROXY=true` and `TENANT_BASE_DOMAIN=booking.localhost`.

**Tech Stack:** Docker Compose v2, Caddy 2.11.3, Next.js 16.2.12, Node.js 22+, pnpm 10.34.5, `node:test`, `yaml`.

## Global Constraints

- Caddy is opt-in under Compose profile `https`; normal `pnpm infra:up` must not start it.
- Pin `CADDY_VERSION=2.11.3` in `.env.docker.example`.
- Browser entry points are `https://platform.booking.localhost` and `https://<tenant>.booking.localhost`.
- Reverse proxy target is `host.docker.internal:3002`; Linux gets `host.docker.internal:host-gateway`.
- Do not proxy the API, PostgreSQL, Redis, MinIO, or Mailpit through Caddy.
- Keep `SESSION_ALLOWED_ORIGINS` an exact allowlist; do not implement wildcard CSRF origins.
- Keep `__Host-booking_session` Secure, HttpOnly, host-only, and Path `/`.
- Do not commit certificate or private-key material.
- Keep Next.js dev host behavior unchanged; Next 16 already defaults `next dev` to `0.0.0.0`, and `apps/web-console/next.config.ts` already allows `*.booking.localhost`.
- API environment changes require an API restart because environment is loaded at bootstrap.
- Do not begin Sprint 1B.4 authorization work in this plan.

---

### Task 1: Add executable HTTPS infrastructure with regression coverage

**Files:**
- Create: `infra/caddy/Caddyfile`
- Create: `scripts/infra/local-https-config.test.mjs`
- Modify: `compose.yaml`
- Modify: `.env.docker.example`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing root `test:scripts`, `infra:*` commands, `.env.docker`, and host-running web console on port 3002.
- Produces: Compose service `caddy`, profile `https`, scripts `infra:https:config`, `infra:https:up`, `infra:https:logs`, `infra:https:down`, and Caddy local CA persisted in `caddy_data`.

- [ ] **Step 1: Write the failing infrastructure contract test**

Create `scripts/infra/local-https-config.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import YAML from "yaml";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const [composeSource, dockerEnv, caddyfile, packageJson] = await Promise.all([
  readFile("compose.yaml", "utf8"),
  readFile(".env.docker.example", "utf8"),
  readFile("infra/caddy/Caddyfile", "utf8"),
  readJson("package.json"),
]);

const compose = YAML.parse(composeSource);

test("local HTTPS is opt-in and pins Caddy", () => {
  assert.match(dockerEnv, /^CADDY_VERSION=2\.11\.3$/m);
  assert.deepEqual(compose.services.caddy.profiles, ["https"]);
  assert.equal(compose.services.caddy.image, "caddy:${CADDY_VERSION:?CADDY_VERSION is required}");
  assert.deepEqual(compose.services.caddy.ports, [
    "${CADDY_HTTP_PORT:?CADDY_HTTP_PORT is required}:80",
    "${CADDY_HTTPS_PORT:?CADDY_HTTPS_PORT is required}:443",
  ]);
});

test("Caddy preserves the browser hostname and proxies only to the host console", () => {
  assert.deepEqual(compose.services.caddy.extra_hosts, ["host.docker.internal:host-gateway"]);
  assert.match(caddyfile, /platform\.booking\.localhost/);
  assert.match(caddyfile, /\*\.booking\.localhost/);
  assert.match(caddyfile, /tls internal/);
  assert.match(caddyfile, /reverse_proxy host\.docker\.internal:3002/);
  assert.doesNotMatch(caddyfile, /3001|5432|6379|9000|8025/);
});

test("repository scripts expose HTTPS lifecycle without changing normal infra:up", () => {
  assert.equal(packageJson.scripts["infra:up"], "docker compose --env-file .env.docker up -d --build");
  assert.equal(
    packageJson.scripts["infra:https:config"],
    "docker compose --env-file .env.docker --profile https config --quiet",
  );
  assert.equal(
    packageJson.scripts["infra:https:up"],
    "docker compose --env-file .env.docker --profile https up -d caddy",
  );
  assert.equal(
    packageJson.scripts["infra:https:logs"],
    "docker compose --env-file .env.docker --profile https logs -f caddy",
  );
  assert.equal(
    packageJson.scripts["infra:https:down"],
    "docker compose --env-file .env.docker --profile https stop caddy",
  );
});
```

- [ ] **Step 2: Run the focused RED test**

Run:

```bash
node --test scripts/infra/local-https-config.test.mjs
```

Expected: FAIL before test execution with `ENOENT` for `infra/caddy/Caddyfile`.

- [ ] **Step 3: Add the minimal Caddy configuration**

Create `infra/caddy/Caddyfile`:

```caddyfile
platform.booking.localhost, *.booking.localhost {
  tls internal
  reverse_proxy host.docker.internal:3002
}
```

Do not add `header_up Host`; Caddy reverse proxy preserves the incoming Host by default and the application must continue deriving scope from that original hostname.

- [ ] **Step 4: Add the opt-in Compose service and persistent CA volumes**

Add under `services:` in `compose.yaml`:

```yaml
  caddy:
    image: caddy:${CADDY_VERSION:?CADDY_VERSION is required}
    profiles:
      - https
    restart: unless-stopped
    ports:
      - "${CADDY_HTTP_PORT:?CADDY_HTTP_PORT is required}:80"
      - "${CADDY_HTTPS_PORT:?CADDY_HTTPS_PORT is required}:443"
    extra_hosts:
      - host.docker.internal:host-gateway
    volumes:
      - ./infra/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - booking-network
```

Add under `volumes:`:

```yaml
  caddy_data:
  caddy_config:
```

- [ ] **Step 5: Pin Caddy and local TLS ports**

Append to `.env.docker.example`:

```dotenv
CADDY_VERSION=2.11.3
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
```

- [ ] **Step 6: Add repository HTTPS lifecycle scripts**

Add to `package.json` scripts adjacent to the existing `infra:*` commands:

```json
"infra:https:config": "docker compose --env-file .env.docker --profile https config --quiet",
"infra:https:up": "docker compose --env-file .env.docker --profile https up -d caddy",
"infra:https:logs": "docker compose --env-file .env.docker --profile https logs -f caddy",
"infra:https:down": "docker compose --env-file .env.docker --profile https stop caddy"
```

Do not modify `infra:up`.

- [ ] **Step 7: Run the focused GREEN test and Compose validation**

Run:

```bash
node --test scripts/infra/local-https-config.test.mjs
cp .env.docker.example .env.docker
pnpm infra:config
pnpm infra:https:config
```

Expected: all commands exit 0.

- [ ] **Step 8: Verify profile isolation from rendered Compose config**

Run:

```bash
docker compose --env-file .env.docker config --services
docker compose --env-file .env.docker --profile https config --services
```

Expected:
- without profile: `caddy` is absent;
- with profile: `caddy` is present along with the normal services.

- [ ] **Step 9: Commit Task 1**

```bash
git add infra/caddy/Caddyfile scripts/infra/local-https-config.test.mjs compose.yaml .env.docker.example package.json
git commit -m "feat: add opt-in local HTTPS proxy"
```

---

### Task 2: Document full local identity, platform, and tenant browser workflow

**Files:**
- Create: `docs/runbooks/local-https-development.md`
- Modify: `README.md`
- Test: `scripts/infra/local-https-config.test.mjs`

**Interfaces:**
- Consumes: Task 1 scripts, API `.env.example`, worker `.env.example`, Mailpit, platform-admin bootstrap CLI, existing `/activate`, `/login`, `/platform/create`, `/invite/accept`, and `/settings/members` routes.
- Produces: one authoritative local HTTPS runbook linked from README.

- [ ] **Step 1: Extend the failing contract test with documentation anchors**

Append to `scripts/infra/local-https-config.test.mjs`:

```js
test("local HTTPS runbook documents the real secure browser workflow", async () => {
  const runbook = await readFile("docs/runbooks/local-https-development.md", "utf8");
  const readme = await readFile("README.md", "utf8");

  for (const required of [
    "https://platform.booking.localhost",
    "https://acme-studio.booking.localhost",
    "TRUST_PROXY=true",
    "TENANT_BASE_DOMAIN=booking.localhost",
    "PLATFORM_HOSTNAME=platform.booking.localhost",
    "SESSION_ALLOWED_ORIGINS=",
    "identity:bootstrap-platform-admin",
    "http://localhost:8025",
    "pnpm infra:https:up",
    "pnpm test:e2e",
  ]) {
    assert.match(runbook, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(readme, /local-https-development\.md/);
  assert.doesNotMatch(readme, /no real login or cookie storage/);
});
```

- [ ] **Step 2: Run the documentation RED test**

Run:

```bash
node --test scripts/infra/local-https-config.test.mjs
```

Expected: FAIL with `ENOENT` for `docs/runbooks/local-https-development.md` and/or stale README assertion.

- [ ] **Step 3: Write the authoritative local HTTPS runbook**

Create `docs/runbooks/local-https-development.md` with these concrete sections and commands:

```markdown
# Local HTTPS Development

## Prerequisites
- Docker Desktop / Docker Compose v2
- Node.js 22+
- pnpm 10.34.5

## 1. Local infrastructure
cp .env.docker.example .env.docker
pnpm infra:up
pnpm infra:ps

## 2. API environment
cp apps/api/.env.example apps/api/.env
```

Document this HTTPS-specific API configuration:

```dotenv
TRUST_PROXY=true
TENANT_BASE_DOMAIN=booking.localhost
PLATFORM_HOSTNAME=platform.booking.localhost
SESSION_ALLOWED_ORIGINS=https://platform.booking.localhost,https://acme-studio.booking.localhost
```

State explicitly that the second origin is an example tenant and must be replaced/appended with the exact tenant origins under test, then restart the API after changing the list.

Document web console:

```dotenv
API_BASE_URL=http://127.0.0.1:3001/api
APP_LOCALE=vi
```

Document critical worker setup:

```bash
cp apps/worker-critical/.env.example apps/worker-critical/.env
```

and require matching identity envelope keys plus:

```dotenv
DATABASE_URL=postgresql://booking:booking@127.0.0.1:5432/booking_os
```

Document migrations/startup:

```bash
pnpm --filter @booking-os/api prisma:generate
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm --filter @booking-os/api prisma:seed
pnpm --filter @booking-os/api dev
pnpm --filter @booking-os/web-console dev
pnpm --filter @booking-os/worker-critical dev
pnpm infra:https:up
```

Document Caddy root certificate export:

```bash
docker compose --env-file .env.docker --profile https cp \
  caddy:/data/caddy/pki/authorities/local/root.crt \
  /tmp/booking-os-caddy-root.crt
```

Document macOS trust:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  /tmp/booking-os-caddy-root.crt
```

For Linux, instruct developers to copy the root certificate into the distribution's local CA trust directory and run the distribution-specific CA update command; do not recommend disabling browser TLS verification.

Document platform bootstrap:

```bash
pnpm --filter @booking-os/api identity:bootstrap-platform-admin -- \
  --hostname platform.booking.localhost
```

Document Mailpit at `http://localhost:8025`, then full manual flows:

```text
https://platform.booking.localhost/activate#token=<TOKEN>
https://platform.booking.localhost/login
https://platform.booking.localhost/platform/create
https://acme-studio.booking.localhost/invite/accept#token=<TOKEN>
https://acme-studio.booking.localhost/settings/members
```

Document diagnostics:

```bash
curl -i http://127.0.0.1:3001/api/health
curl -i http://127.0.0.1:3001/api/ready
pnpm infra:https:logs
```

Document tests:

```bash
pnpm --filter @booking-os/web-console test
pnpm test:e2e
pnpm verify:foundation
```

Document cleanup and CA persistence semantics:

```bash
pnpm infra:https:down
pnpm infra:down
pnpm infra:reset
```

Warn that `infra:reset` removes the Caddy data volume and a new local CA may need to be trusted afterward.

- [ ] **Step 4: Correct README runtime claims and link the runbook**

Update the runtime table row for Console from the stale text:

```text
Demonstration partner session; no real login or cookie storage
```

to a concise accurate description such as:

```text
Operations console with real identity/session, platform provisioning, and tenant membership flows
```

Add a Local HTTPS subsection that links `docs/runbooks/local-https-development.md` and says normal `pnpm infra:up` remains HTTP/direct-port development while the runbook enables full HTTPS tenant-browser testing.

- [ ] **Step 5: Run the GREEN test and static docs checks**

Run:

```bash
node --test scripts/infra/local-https-config.test.mjs
pnpm test:scripts
pnpm check:ci
pnpm genesis:validate
```

Expected: all exit 0.

- [ ] **Step 6: Commit Task 2**

```bash
git add docs/runbooks/local-https-development.md README.md scripts/infra/local-https-config.test.mjs
git commit -m "docs: add local HTTPS browser runbook"
```

---

### Task 3: Verify the full repository baseline and local HTTPS contract

**Files:**
- Modify only if verification exposes a defect in Task 1 or Task 2.

**Interfaces:**
- Consumes: completed Tasks 1–2.
- Produces: clean-head evidence that local HTTPS is additive and does not weaken or regress existing Booking OS gates.

- [ ] **Step 1: Run focused infrastructure verification**

```bash
cp .env.docker.example .env.docker
pnpm infra:config
pnpm infra:https:config
pnpm test:scripts
```

Expected: PASS.

- [ ] **Step 2: Run static and architecture gates**

```bash
pnpm check:ci
pnpm verify:frontend-libraries
pnpm verify:architecture
pnpm lint
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run repository behavior/build gates**

With PostgreSQL and Redis available using the documented local configuration:

```bash
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm test
pnpm test:e2e:api
pnpm verify:migrations
pnpm build
pnpm test:e2e
pnpm verify:production-config
```

Expected: PASS.

- [ ] **Step 4: Inspect the final diff for security regressions**

Confirm all of the following from the final diff:

```text
No wildcard SESSION_ALLOWED_ORIGINS support.
No insecure cookie changes.
No API/DB/Redis/MinIO/Mailpit route in Caddyfile.
No committed certificate/private-key files.
No change to normal infra:up semantics.
No authorization/RLS changes.
```

- [ ] **Step 5: Commit any verification-only correction if required**

If verification required a correction, commit only the minimal correction with a focused message, then rerun every affected command. If no correction is required, do not create an empty commit.
