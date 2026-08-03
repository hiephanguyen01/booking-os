# Docker Compose Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible local Docker Compose stack for PostgreSQL, Redis, source-built MinIO, and Mailpit while the NestJS API continues to run on the host.

**Architecture:** A root-level `compose.yaml` owns local infrastructure only. PostgreSQL, Redis, and MinIO use named volumes and explicit health checks; Mailpit remains ephemeral. MinIO Community is compiled from pinned source revisions into a local non-root image containing both `minio` and `mc`, and a one-shot `minio-init` service creates the private default bucket idempotently.

**Tech Stack:** Docker Compose v2, PostgreSQL 17.10, Redis 8.8.1 Alpine, Go 1.24.6 Alpine builder, Alpine 3.22 runtime, MinIO server `RELEASE.2025-10-15T17-29-55Z`, MinIO client `RELEASE.2025-08-13T08-35-41Z`, Mailpit v1.30.0, POSIX shell, SQL.

## Global Constraints

- Keep `compose.yaml` at the repository root.
- Run infrastructure only; do not containerize the NestJS API in this plan.
- Never use `latest`, floating major tags, unpinned source revisions, or unpinned build/runtime images.
- Do not declare `container_name`.
- Use one bridge network named `booking-network`.
- Use named volumes named `postgres_data`, `redis_data`, and `minio_data`.
- Every long-running service must have a health check.
- Keep `.env.docker` and `compose.override.yaml` untracked; keep `.env.docker.example` tracked.
- Pass only the environment variables each service needs; do not use a shared `env_file` block.
- Use `${VARIABLE:?message}` for required Compose interpolation.
- Use `$$VARIABLE` when a variable must be expanded inside a container.
- PostgreSQL init scripts may create only foundational extensions, not application schema or seed data.
- The MinIO runtime image must run as non-root UID/GID 1000.
- The MinIO bucket initialization script must use `set -eu` and remain idempotent.
- The default MinIO bucket must remain private.
- Do not add API readiness checks in this plan.

---

## File Map

- Create `compose.yaml`: Compose topology, service configuration, health checks, volumes, network, and MinIO build wiring.
- Create `.env.docker.example`: committed local infrastructure contract and explicit version pins.
- Modify `.gitignore`: explicitly ignore `.env.docker` and `compose.override.yaml` while preserving example files.
- Create `infra/postgres/init/001-bootstrap.sql`: foundational PostgreSQL extensions only.
- Create `infra/minio/Dockerfile`: compile pinned MinIO server/client source revisions and create a minimal non-root runtime image.
- Create `infra/minio/create-buckets.sh`: configure local alias, create the default bucket idempotently, and enforce private access.
- Modify `package.json`: add root scripts for infrastructure validation, build, startup, status, logs, shutdown, and destructive reset.
- Modify `README.md`: document prerequisites, local endpoints, credentials, commands, data lifecycle, and troubleshooting.

---

### Task 1: Establish the Docker environment contract and ignore rules

**Files:**
- Create: `.env.docker.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: Compose variables consumed by `compose.yaml` and `infra/minio/Dockerfile`.
- Produces: Git ignore guarantees for `.env.docker` and `compose.override.yaml`.

- [ ] **Step 1: Verify the current ignore behavior before changing it**

Run:

```bash
git check-ignore -v .env.docker || true
git check-ignore -v .env.docker.example || true
git check-ignore -v compose.override.yaml || true
```

Expected:

- `.env.docker` is already ignored by the broad `.env.*` rule.
- `.env.docker.example` is not ignored because `!.env.*.example` re-includes it.
- `compose.override.yaml` is not yet ignored.

- [ ] **Step 2: Create `.env.docker.example`**

Create the file with exactly:

```dotenv
COMPOSE_PROJECT_NAME=booking-os

POSTGRES_VERSION=17.10
POSTGRES_DB=booking_os
POSTGRES_USER=booking
POSTGRES_PASSWORD=booking
POSTGRES_PORT=5432

REDIS_VERSION=8.8.1-alpine
REDIS_PORT=6379

MINIO_GO_IMAGE_VERSION=1.24.6-alpine3.22
MINIO_ALPINE_VERSION=3.22
MINIO_SERVER_VERSION=RELEASE.2025-10-15T17-29-55Z
MINIO_CLIENT_VERSION=RELEASE.2025-08-13T08-35-41Z
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=minio123
MINIO_DEFAULT_BUCKET=booking-os
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001

MAILPIT_VERSION=v1.30.0
MAILPIT_SMTP_PORT=1025
MAILPIT_UI_PORT=8025
```

- [ ] **Step 3: Make local Compose overrides explicitly untracked**

Append this section to `.gitignore` immediately after the environment section:

```gitignore
# Docker Compose local overrides
.env.docker
compose.override.yaml
```

Do not remove the existing rules:

```gitignore
.env
.env.*
!.env.example
!.env.*.example
```

- [ ] **Step 4: Verify tracked and ignored files**

Run:

```bash
git check-ignore -v .env.docker
git check-ignore -v compose.override.yaml
if git check-ignore -q .env.docker.example; then
  echo ".env.docker.example must be tracked" >&2
  exit 1
fi
```

Expected: command exits 0 and `.env.docker.example` remains trackable.

- [ ] **Step 5: Commit the environment contract**

```bash
git add .env.docker.example .gitignore
git commit -m "chore(infra): define local Docker environment"
```

---

### Task 2: Add PostgreSQL bootstrap initialization

**Files:**
- Create: `infra/postgres/init/001-bootstrap.sql`

**Interfaces:**
- Consumes: PostgreSQL official image initialization contract at `/docker-entrypoint-initdb.d`.
- Produces: `pgcrypto`, `citext`, and `btree_gist` extensions in the initially created database.

- [ ] **Step 1: Create the init directory**

```bash
mkdir -p infra/postgres/init
```

- [ ] **Step 2: Create the bootstrap SQL**

Create `infra/postgres/init/001-bootstrap.sql` with exactly:

```sql
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

- [ ] **Step 3: Assert that application schema was not added**

Run:

```bash
if grep -Eiq '\b(CREATE[[:space:]]+TABLE|INSERT[[:space:]]+INTO|CREATE[[:space:]]+SCHEMA|CREATE[[:space:]]+POLICY)\b' infra/postgres/init/001-bootstrap.sql; then
  echo "PostgreSQL bootstrap must not contain application schema or seed data" >&2
  exit 1
fi
```

Expected: command exits 0.

- [ ] **Step 4: Commit the PostgreSQL bootstrap**

```bash
git add infra/postgres/init/001-bootstrap.sql
git commit -m "chore(infra): add PostgreSQL bootstrap extensions"
```

---

### Task 3: Build a pinned non-root MinIO image from source

**Files:**
- Create: `infra/minio/Dockerfile`

**Interfaces:**
- Consumes build args:
  - `GO_IMAGE_VERSION: string`
  - `ALPINE_VERSION: string`
  - `MINIO_SERVER_VERSION: string`
  - `MINIO_CLIENT_VERSION: string`
- Produces executables:
  - `/usr/local/bin/minio`
  - `/usr/local/bin/mc`
- Produces runtime user/group UID/GID 1000.

- [ ] **Step 1: Create the MinIO directory**

```bash
mkdir -p infra/minio
```

- [ ] **Step 2: Create `infra/minio/Dockerfile`**

Create the file with exactly:

```dockerfile
# syntax=docker/dockerfile:1.7

ARG GO_IMAGE_VERSION
ARG ALPINE_VERSION

FROM golang:${GO_IMAGE_VERSION} AS builder

ARG MINIO_SERVER_VERSION
ARG MINIO_CLIENT_VERSION

ENV CGO_ENABLED=0

RUN test -n "${MINIO_SERVER_VERSION}" \
  && test -n "${MINIO_CLIENT_VERSION}" \
  && GOBIN=/out go install "github.com/minio/minio@${MINIO_SERVER_VERSION}" \
  && GOBIN=/out go install "github.com/minio/mc@${MINIO_CLIENT_VERSION}"

FROM alpine:${ALPINE_VERSION} AS runtime

RUN apk add --no-cache ca-certificates curl \
  && addgroup -g 1000 -S minio \
  && adduser -u 1000 -S -D -H -G minio minio \
  && mkdir -p /data \
  && chown minio:minio /data

COPY --from=builder /out/minio /usr/local/bin/minio
COPY --from=builder /out/mc /usr/local/bin/mc

USER minio:minio
WORKDIR /data

EXPOSE 9000 9001

ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
```

- [ ] **Step 3: Run static Dockerfile safeguards**

Run:

```bash
grep -F 'ENV CGO_ENABLED=0' infra/minio/Dockerfile
grep -F 'USER minio:minio' infra/minio/Dockerfile
grep -F 'github.com/minio/minio@${MINIO_SERVER_VERSION}' infra/minio/Dockerfile
grep -F 'github.com/minio/mc@${MINIO_CLIENT_VERSION}' infra/minio/Dockerfile
if grep -Eq 'FROM .*:(latest|edge)([[:space:]]|$)' infra/minio/Dockerfile; then
  echo "Floating base image tag detected" >&2
  exit 1
fi
```

Expected: every `grep` succeeds and no floating image tag is detected.

- [ ] **Step 4: Commit the source build definition**

```bash
git add infra/minio/Dockerfile
git commit -m "build(infra): add pinned MinIO source image"
```

---

### Task 4: Add idempotent private MinIO bucket initialization

**Files:**
- Create: `infra/minio/create-buckets.sh`

**Interfaces:**
- Consumes environment variables:
  - `MINIO_ROOT_USER: string`
  - `MINIO_ROOT_PASSWORD: string`
  - `MINIO_DEFAULT_BUCKET: string`
- Consumes service endpoint: `http://minio:9000`
- Produces: existing private bucket named by `MINIO_DEFAULT_BUCKET`.

- [ ] **Step 1: Create the bucket initialization script**

Create `infra/minio/create-buckets.sh` with exactly:

```sh
#!/bin/sh

set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${MINIO_DEFAULT_BUCKET:?MINIO_DEFAULT_BUCKET is required}"

mc alias set \
  local \
  http://minio:9000 \
  "$MINIO_ROOT_USER" \
  "$MINIO_ROOT_PASSWORD"

mc mb \
  --ignore-existing \
  "local/$MINIO_DEFAULT_BUCKET"

mc anonymous set \
  none \
  "local/$MINIO_DEFAULT_BUCKET"

printf 'MinIO bucket is ready: %s\n' "$MINIO_DEFAULT_BUCKET"
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x infra/minio/create-buckets.sh
```

- [ ] **Step 3: Run shell syntax and invariant checks**

Run:

```bash
sh -n infra/minio/create-buckets.sh
grep -F 'set -eu' infra/minio/create-buckets.sh
grep -F -- '--ignore-existing' infra/minio/create-buckets.sh
grep -F 'mc anonymous set' infra/minio/create-buckets.sh
grep -F 'none' infra/minio/create-buckets.sh
```

Expected: all checks pass.

- [ ] **Step 4: Verify fail-fast behavior without secrets**

Run:

```bash
env -i PATH="$PATH" sh infra/minio/create-buckets.sh >/tmp/booking-os-minio-init.out 2>/tmp/booking-os-minio-init.err && exit 1 || true
grep -F 'MINIO_ROOT_USER is required' /tmp/booking-os-minio-init.err
```

Expected: the script fails before attempting a network call and reports the missing variable.

- [ ] **Step 5: Commit the bucket bootstrap**

```bash
git add infra/minio/create-buckets.sh
git commit -m "chore(infra): add MinIO bucket bootstrap"
```

---

### Task 5: Define the root Docker Compose topology

**Files:**
- Create: `compose.yaml`

**Interfaces:**
- Consumes: every variable defined in `.env.docker.example`.
- Consumes: `infra/minio/Dockerfile`, `infra/minio/create-buckets.sh`, and `infra/postgres/init/001-bootstrap.sql`.
- Produces services: `postgres`, `redis`, `minio`, `minio-init`, and `mailpit`.
- Produces volumes: `postgres_data`, `redis_data`, and `minio_data`.
- Produces network: `booking-network`.

- [ ] **Step 1: Write the initial invalid Compose reference test**

Before creating `compose.yaml`, copy the environment example and verify the expected failure:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker config
```

Expected: FAIL because `compose.yaml` does not exist yet.

- [ ] **Step 2: Create `compose.yaml`**

Create the file with exactly:

```yaml
name: ${COMPOSE_PROJECT_NAME:?COMPOSE_PROJECT_NAME is required}

services:
  postgres:
    image: postgres:${POSTGRES_VERSION:?POSTGRES_VERSION is required}
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?POSTGRES_DB is required}
      POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER is required}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
    ports:
      - "${POSTGRES_PORT:?POSTGRES_PORT is required}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test:
        - CMD-SHELL
        - pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 10s
    networks:
      - booking-network

  redis:
    image: redis:${REDIS_VERSION:?REDIS_VERSION is required}
    restart: unless-stopped
    command:
      - redis-server
      - --appendonly
      - "yes"
      - --appendfsync
      - everysec
    ports:
      - "${REDIS_PORT:?REDIS_PORT is required}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test:
        - CMD
        - redis-cli
        - ping
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 5s
    networks:
      - booking-network

  minio:
    image: booking-os/minio:${MINIO_SERVER_VERSION:?MINIO_SERVER_VERSION is required}
    build:
      context: .
      dockerfile: infra/minio/Dockerfile
      args:
        GO_IMAGE_VERSION: ${MINIO_GO_IMAGE_VERSION:?MINIO_GO_IMAGE_VERSION is required}
        ALPINE_VERSION: ${MINIO_ALPINE_VERSION:?MINIO_ALPINE_VERSION is required}
        MINIO_SERVER_VERSION: ${MINIO_SERVER_VERSION:?MINIO_SERVER_VERSION is required}
        MINIO_CLIENT_VERSION: ${MINIO_CLIENT_VERSION:?MINIO_CLIENT_VERSION is required}
    restart: unless-stopped
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}
    ports:
      - "${MINIO_API_PORT:?MINIO_API_PORT is required}:9000"
      - "${MINIO_CONSOLE_PORT:?MINIO_CONSOLE_PORT is required}:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test:
        - CMD
        - curl
        - --fail
        - --silent
        - --show-error
        - http://localhost:9000/minio/health/live
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 10s
    networks:
      - booking-network

  minio-init:
    image: booking-os/minio:${MINIO_SERVER_VERSION:?MINIO_SERVER_VERSION is required}
    restart: "no"
    depends_on:
      minio:
        condition: service_healthy
    entrypoint:
      - /bin/sh
      - /scripts/create-buckets.sh
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}
      MINIO_DEFAULT_BUCKET: ${MINIO_DEFAULT_BUCKET:?MINIO_DEFAULT_BUCKET is required}
    volumes:
      - ./infra/minio/create-buckets.sh:/scripts/create-buckets.sh:ro
    networks:
      - booking-network

  mailpit:
    image: axllent/mailpit:${MAILPIT_VERSION:?MAILPIT_VERSION is required}
    restart: unless-stopped
    ports:
      - "${MAILPIT_SMTP_PORT:?MAILPIT_SMTP_PORT is required}:1025"
      - "${MAILPIT_UI_PORT:?MAILPIT_UI_PORT is required}:8025"
    healthcheck:
      test:
        - CMD
        - /mailpit
        - readyz
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 5s
    networks:
      - booking-network

volumes:
  postgres_data:
  redis_data:
  minio_data:

networks:
  booking-network:
    driver: bridge
```

- [ ] **Step 3: Validate Compose interpolation and schema**

Run:

```bash
docker compose --env-file .env.docker config --quiet
```

Expected: exits 0 with no error.

- [ ] **Step 4: Verify required variables fail early**

Run:

```bash
env_file="$(mktemp)"
grep -v '^POSTGRES_PASSWORD=' .env.docker.example >"$env_file"
if docker compose --env-file "$env_file" config --quiet >/tmp/booking-os-compose.out 2>/tmp/booking-os-compose.err; then
  echo "Compose unexpectedly accepted a missing required variable" >&2
  rm -f "$env_file"
  exit 1
fi
grep -F 'POSTGRES_PASSWORD is required' /tmp/booking-os-compose.err
rm -f "$env_file"
```

Expected: Compose rejects the configuration with the explicit error message.

- [ ] **Step 5: Verify structural invariants**

Run:

```bash
if grep -Eq '^[[:space:]]*container_name:' compose.yaml; then
  echo "container_name is forbidden" >&2
  exit 1
fi
if grep -Eq 'image:[[:space:]].*:(latest|edge)([[:space:]]|$)' compose.yaml; then
  echo "Floating image tag detected" >&2
  exit 1
fi
grep -F 'postgres_data:' compose.yaml
grep -F 'redis_data:' compose.yaml
grep -F 'minio_data:' compose.yaml
grep -F 'booking-network:' compose.yaml
```

Expected: no forbidden declarations and all named resources exist.

- [ ] **Step 6: Build the custom MinIO image**

Run:

```bash
docker compose --env-file .env.docker build minio
```

Expected: build exits 0 and produces `booking-os/minio:RELEASE.2025-10-15T17-29-55Z`.

- [ ] **Step 7: Verify the custom image contents and user**

Run:

```bash
docker run --rm --entrypoint /bin/sh \
  booking-os/minio:RELEASE.2025-10-15T17-29-55Z \
  -c 'test "$(id -u)" = 1000 && test "$(id -g)" = 1000 && minio --version && mc --version'
```

Expected: UID and GID are both 1000; both version commands succeed.

- [ ] **Step 8: Commit the Compose topology**

```bash
git add compose.yaml
git commit -m "feat(infra): add local Docker Compose stack"
```

---

### Task 6: Add root infrastructure scripts

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces root commands:
  - `infra:config`
  - `infra:build`
  - `infra:up`
  - `infra:ps`
  - `infra:logs`
  - `infra:down`
  - `infra:reset`

- [ ] **Step 1: Add scripts to the root `package.json`**

Insert these keys into the existing `scripts` object without removing current scripts:

```json
"infra:config": "docker compose --env-file .env.docker config --quiet",
"infra:build": "docker compose --env-file .env.docker build",
"infra:up": "docker compose --env-file .env.docker up -d --build",
"infra:ps": "docker compose --env-file .env.docker ps",
"infra:logs": "docker compose --env-file .env.docker logs -f",
"infra:down": "docker compose --env-file .env.docker down",
"infra:reset": "docker compose --env-file .env.docker down --volumes --remove-orphans"
```

Keep `clean` as the final non-infrastructure script or run the formatter afterward; JSON key ordering is not semantically significant.

- [ ] **Step 2: Validate JSON syntax**

Run:

```bash
node -e 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8"))'
```

Expected: exits 0.

- [ ] **Step 3: Validate the script wiring**

Run:

```bash
pnpm infra:config
```

Expected: exits 0.

- [ ] **Step 4: Commit the root commands**

```bash
git add package.json
git commit -m "chore(infra): add local infrastructure commands"
```

---

### Task 7: Start the stack and verify every dependency

**Files:**
- No source file changes expected.
- Runtime-only file: `.env.docker` remains untracked.

**Interfaces:**
- Verifies host endpoints:
  - PostgreSQL: `localhost:${POSTGRES_PORT}`
  - Redis: `localhost:${REDIS_PORT}`
  - MinIO API: `localhost:${MINIO_API_PORT}`
  - MinIO Console: `localhost:${MINIO_CONSOLE_PORT}`
  - Mailpit SMTP: `localhost:${MAILPIT_SMTP_PORT}`
  - Mailpit UI: `localhost:${MAILPIT_UI_PORT}`

- [ ] **Step 1: Start the complete stack**

Run:

```bash
pnpm infra:up
```

Expected: PostgreSQL, Redis, MinIO, and Mailpit start; `minio-init` waits for MinIO health and exits 0.

- [ ] **Step 2: Wait until all long-running services are healthy**

Run:

```bash
for attempt in $(seq 1 60); do
  statuses="$(docker compose --env-file .env.docker ps --format json)"
  printf '%s\n' "$statuses"

  unhealthy_count="$(printf '%s\n' "$statuses" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const rows = input.trim().split(/\n+/).filter(Boolean).map(JSON.parse);
      const targets = new Set(["postgres", "redis", "minio", "mailpit"]);
      const unhealthy = rows.filter((row) => targets.has(row.Service) && row.Health !== "healthy");
      process.stdout.write(String(unhealthy.length));
    });
  ')"

  if [ "$unhealthy_count" = "0" ]; then
    break
  fi

  if [ "$attempt" = "60" ]; then
    echo "Infrastructure did not become healthy" >&2
    exit 1
  fi

  sleep 2
done
```

Expected: all four services report `healthy` before timeout.

- [ ] **Step 3: Verify PostgreSQL connectivity and extensions**

Run:

```bash
docker compose --env-file .env.docker exec -T postgres \
  psql \
  -U booking \
  -d booking_os \
  -v ON_ERROR_STOP=1 \
  -Atc "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'citext', 'btree_gist') ORDER BY extname;"
```

Expected output:

```text
btree_gist
citext
pgcrypto
```

- [ ] **Step 4: Verify Redis connectivity and AOF configuration**

Run:

```bash
docker compose --env-file .env.docker exec -T redis redis-cli ping
docker compose --env-file .env.docker exec -T redis redis-cli CONFIG GET appendonly
docker compose --env-file .env.docker exec -T redis redis-cli CONFIG GET appendfsync
```

Expected:

- `PONG`
- `appendonly` is `yes`
- `appendfsync` is `everysec`

- [ ] **Step 5: Verify MinIO health, bucket existence, and privacy**

Run:

```bash
curl --fail --silent --show-error http://localhost:9000/minio/health/live

docker compose --env-file .env.docker run --rm --entrypoint /bin/sh minio-init -c '
  set -eu
  mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
  mc stat "local/$MINIO_DEFAULT_BUCKET"
  mc anonymous get "local/$MINIO_DEFAULT_BUCKET" | grep -F "Access permission for local/$MINIO_DEFAULT_BUCKET is set to none"
'
```

Expected: health request succeeds, bucket stat succeeds, and anonymous access reports `none`.

- [ ] **Step 6: Verify Mailpit readiness and UI**

Run:

```bash
docker compose --env-file .env.docker exec -T mailpit /mailpit readyz
curl --fail --silent --show-error http://localhost:8025/readyz
```

Expected: both readiness checks succeed.

- [ ] **Step 7: Verify `minio-init` completed successfully**

Run:

```bash
test "$(docker compose --env-file .env.docker ps -a --format json minio-init | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const row = JSON.parse(input.trim());
    process.stdout.write(String(row.ExitCode));
  });
')" = "0"
```

Expected: exits 0.

- [ ] **Step 8: Confirm no runtime secrets or data are staged**

Run:

```bash
if git status --short | grep -E '(^|[[:space:]])(\.env\.docker|compose\.override\.yaml|data/|storage/)'; then
  echo "Runtime-only Docker state must not be committed" >&2
  exit 1
fi
```

Expected: no match.

---

### Task 8: Verify named-volume persistence and destructive reset

**Files:**
- No source file changes expected.

**Interfaces:**
- Verifies that `infra:down` preserves data.
- Verifies that `infra:reset` removes data.

- [ ] **Step 1: Write persistence sentinels**

Run:

```bash
docker compose --env-file .env.docker exec -T postgres \
  psql -U booking -d booking_os -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE IF NOT EXISTS local_infra_sentinel (id integer PRIMARY KEY); INSERT INTO local_infra_sentinel (id) VALUES (1) ON CONFLICT DO NOTHING;"

docker compose --env-file .env.docker exec -T redis redis-cli SET booking-os:infra-sentinel present
```

Expected: both commands succeed.

- [ ] **Step 2: Stop services without removing volumes**

Run:

```bash
pnpm infra:down
pnpm infra:up
```

Expected: services restart successfully.

- [ ] **Step 3: Verify sentinels survived**

Run:

```bash
test "$(docker compose --env-file .env.docker exec -T postgres psql -U booking -d booking_os -Atc 'SELECT count(*) FROM local_infra_sentinel WHERE id = 1;')" = "1"
test "$(docker compose --env-file .env.docker exec -T redis redis-cli --raw GET booking-os:infra-sentinel | tr -d '\r')" = "present"
```

Expected: both tests pass.

- [ ] **Step 4: Remove services and named volumes**

Run:

```bash
pnpm infra:reset
pnpm infra:up
```

Expected: services restart with fresh data volumes.

- [ ] **Step 5: Verify previous sentinels are gone**

Run:

```bash
if docker compose --env-file .env.docker exec -T postgres \
  psql -U booking -d booking_os -Atc "SELECT to_regclass('public.local_infra_sentinel');" \
  | grep -q 'local_infra_sentinel'; then
  echo "PostgreSQL sentinel survived destructive reset" >&2
  exit 1
fi

test "$(docker compose --env-file .env.docker exec -T redis redis-cli --raw EXISTS booking-os:infra-sentinel | tr -d '\r')" = "0"
```

Expected: PostgreSQL table does not exist and Redis reports key count `0`.

- [ ] **Step 6: Leave the stack in a documented developer state**

Choose one state and document it in the execution report:

```bash
pnpm infra:down
```

Expected: containers are stopped and named volumes remain available for the next developer startup.

---

### Task 9: Document local infrastructure usage

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces onboarding instructions and endpoint reference for developers.

- [ ] **Step 1: Add a `Local infrastructure` section to `README.md`**

Append this section after the existing `Bắt đầu` section and before `Cấu trúc`:

```markdown
## Local infrastructure

### Prerequisites

- Docker Desktop or Docker Engine with Docker Compose v2.
- Node.js and pnpm versions declared in the root `package.json`.

### Initialize

```bash
cp .env.docker.example .env.docker
pnpm infra:config
pnpm infra:up
```

The first startup builds MinIO Community from pinned source revisions, so it takes longer than later startups.

### Services

| Service | Endpoint | Local credentials |
| --- | --- | --- |
| PostgreSQL | `localhost:5432/booking_os` | `booking` / `booking` |
| Redis | `localhost:6379` | No password in local development |
| MinIO S3 API | `http://localhost:9000` | `minio` / `minio123` |
| MinIO Console | `http://localhost:9001` | `minio` / `minio123` |
| Mailpit SMTP | `localhost:1025` | No authentication |
| Mailpit UI | `http://localhost:8025` | No authentication |

These credentials are local development defaults only. Do not reuse them outside local development.

### Operations

```bash
pnpm infra:ps
pnpm infra:logs
pnpm infra:down
```

`pnpm infra:down` removes containers but preserves PostgreSQL, Redis, and MinIO named-volume data.

To remove all local infrastructure data:

```bash
pnpm infra:reset
```

This command is destructive.

### API environment

When the API runs on the host, use:

```dotenv
DATABASE_URL=postgresql://booking:booking@localhost:5432/booking_os
REDIS_URL=redis://localhost:6379/0
```

The MinIO API is available at `http://localhost:9000`, and Mailpit accepts SMTP on `localhost:1025`.

### Troubleshooting

Validate the rendered Compose model:

```bash
pnpm infra:config
```

Inspect status and logs:

```bash
pnpm infra:ps
pnpm infra:logs
```

If a host port is already occupied, change only the corresponding host port in `.env.docker`; container ports remain unchanged.
```

- [ ] **Step 2: Check the documented commands exist**

Run:

```bash
for script in infra:config infra:up infra:ps infra:logs infra:down infra:reset; do
  node -e 'const p=require("./package.json"); if (!p.scripts[process.argv[1]]) process.exit(1)' "$script"
done
```

Expected: exits 0.

- [ ] **Step 3: Commit the documentation**

```bash
git add README.md
git commit -m "docs(infra): document local Docker services"
```

---

### Task 10: Run final verification and create the feature commit boundary

**Files:**
- Verify all files created or modified by Tasks 1-9.

**Interfaces:**
- Produces the final evidence that Commit #6 meets its acceptance criteria.

- [ ] **Step 1: Verify repository formatting and static checks**

Run:

```bash
pnpm check
pnpm typecheck
pnpm test
```

Expected: all existing repository checks pass. Docker/YAML/shell/SQL files are additionally covered by the explicit checks in earlier tasks.

- [ ] **Step 2: Validate Compose one final time**

Run:

```bash
pnpm infra:config
docker compose --env-file .env.docker config --images
```

Expected image references include explicit versions and do not include `latest`.

- [ ] **Step 3: Check the final diff and history**

Run:

```bash
git status --short
git log --oneline --decorate -10
git diff origin/chore/monorepo-foundation...HEAD --stat
```

Expected:

- Working tree is clean except for the intentionally untracked/ignored `.env.docker`, which must not appear in `git status`.
- History contains the focused infrastructure commits from this plan.

- [ ] **Step 4: Optional squash to the requested Commit #6 boundary**

If the project requires exactly one implementation commit for Commit #6, squash only the implementation commits created by Tasks 1-9 while preserving the already committed spec and plan documents. Use an interactive rebase against the commit immediately before Task 1 and keep this final message:

```text
infra: add local Docker Compose foundation
```

Do not squash unrelated earlier repository work.

- [ ] **Step 5: Push the branch**

```bash
git push origin chore/monorepo-foundation
```

Expected: remote branch contains the design, implementation plan, and verified Docker Compose foundation.

---

## Final Acceptance Checklist

- [ ] Root `compose.yaml` exists and validates.
- [ ] `.env.docker.example` contains all explicit version pins and local defaults.
- [ ] `.env.docker` and `compose.override.yaml` remain untracked.
- [ ] No `container_name`, `latest`, floating source revision, or unpinned base image exists.
- [ ] PostgreSQL, Redis, MinIO, and Mailpit report healthy.
- [ ] `minio-init` exits with code 0.
- [ ] PostgreSQL creates only `pgcrypto`, `citext`, and `btree_gist` foundational extensions.
- [ ] Redis uses AOF with `appendfsync everysec`.
- [ ] MinIO image contains pinned `minio` and `mc` binaries and runs as UID/GID 1000.
- [ ] Default MinIO bucket exists and has anonymous access `none`.
- [ ] Mailpit readiness succeeds.
- [ ] Normal shutdown preserves named-volume data.
- [ ] Destructive reset removes named-volume data.
- [ ] Root infrastructure scripts work.
- [ ] README documents endpoints, local credentials, lifecycle, API URLs, and troubleshooting.
- [ ] Existing lint, typecheck, and test pipelines still pass.
