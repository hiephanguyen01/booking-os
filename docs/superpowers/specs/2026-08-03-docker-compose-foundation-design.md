# Docker Compose Foundation Design

**Status:** Approved for implementation planning  
**Date:** 2026-08-03  
**Scope:** Local development infrastructure only

## 1. Goal

Provide a reproducible local infrastructure stack for Booking OS while keeping the NestJS API outside Docker for fast local development and debugging.

The stack must start PostgreSQL, Redis, MinIO, and Mailpit from a single root-level `compose.yaml`.

## 2. Decisions

- Keep `compose.yaml` at the repository root.
- Run infrastructure only; the API continues to run with pnpm on the host.
- Pin container images, source revisions, builder images, and runtime images to explicit release or patch tags; never use `latest`.
- Do not declare `container_name`.
- Use one bridge network named `booking-network`.
- Use named volumes for PostgreSQL, Redis, and MinIO data.
- Require health checks for every long-running infrastructure service.
- Create the default MinIO bucket through a one-shot, idempotent `minio-init` service.
- Build the local MinIO image from pinned community source because precompiled community images are legacy and no longer maintained.
- Use the same locally built image for the MinIO server and `mc` initialization command.
- Use `.env.docker.example` as the committed configuration contract and keep `.env.docker` untracked.
- Keep application schema creation out of PostgreSQL container initialization; migrations remain the responsibility of the application migration tool.

## 3. Runtime Topology

```text
Host machine
├── pnpm-managed NestJS API
│   ├── localhost:5432 -> PostgreSQL
│   ├── localhost:6379 -> Redis
│   ├── localhost:9000 -> MinIO S3 API
│   └── localhost:1025 -> Mailpit SMTP
└── Docker Compose
    ├── postgres
    ├── redis
    ├── minio
    ├── minio-init
    └── mailpit
```

Inside the Compose network, services use Compose DNS names such as `postgres`, `redis`, and `minio`.

## 4. Files

```text
compose.yaml
.env.docker.example
infra/postgres/init/001-bootstrap.sql
infra/minio/Dockerfile
infra/minio/create-buckets.sh
README.md
package.json
.gitignore
```

## 5. Service Design

### PostgreSQL

- Image: `postgres:${POSTGRES_VERSION}`
- Default version: `17.10`
- Host port: configurable through `POSTGRES_PORT`
- Named volume: `postgres_data`
- Read-only init mount: `./infra/postgres/init:/docker-entrypoint-initdb.d:ro`
- Health check: `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`
- Restart policy: `unless-stopped`

The init SQL creates only foundational extensions:

- `pgcrypto`
- `citext`
- `btree_gist`

It must not create application tables, tenant schemas, RLS policies, or seed business data.

### Redis

- Image: `redis:${REDIS_VERSION}`
- Default version: `8.8.1-alpine`
- Host port: configurable through `REDIS_PORT`
- Named volume: `redis_data`
- Persistence: AOF enabled with `appendfsync everysec`
- Health check: `redis-cli ping`
- Restart policy: `unless-stopped`

Redis is supporting infrastructure for holds, cache, rate limiting, queues, and short-lived coordination. It is not the transactional source of truth for confirmed bookings, payments, settlement, ledger, or durable occupancy.

### MinIO build

MinIO Community is built from source in `infra/minio/Dockerfile`.

- Builder image: `golang:${MINIO_GO_IMAGE_VERSION}`
- Default builder version: `1.24.13-alpine3.22`
- Runtime image: `alpine:${MINIO_ALPINE_VERSION}`
- Default runtime version: `3.22.5`
- Server source revision: `RELEASE.2025-10-15T17-29-55Z`
- Client source revision: `RELEASE.2025-08-13T08-35-41Z`
- Output image: `booking-os/minio:${MINIO_SERVER_VERSION}`
- Runtime user: non-root UID/GID 1000
- Runtime tools: CA certificates and curl only

The image contains both `/usr/local/bin/minio` and `/usr/local/bin/mc`. Builds must set `CGO_ENABLED=0` and install from exact source revisions.

### MinIO service

- Image: the locally built `booking-os/minio:${MINIO_SERVER_VERSION}`
- API port: configurable through `MINIO_API_PORT`
- Console port: configurable through `MINIO_CONSOLE_PORT`
- Named volume: `minio_data`
- Health check: `http://localhost:9000/minio/health/live`
- Restart policy: `unless-stopped`

The default bucket is private.

### MinIO initialization

- Image: the same locally built `booking-os/minio:${MINIO_SERVER_VERSION}`
- Runs only after MinIO reports healthy.
- Uses `infra/minio/create-buckets.sh` mounted read-only.
- Creates `MINIO_DEFAULT_BUCKET` with `mc mb --ignore-existing`.
- Sets anonymous access to `none`.
- Restart policy: `no`.

The script must use `set -eu` and remain idempotent.

### Mailpit

- Image: `axllent/mailpit:${MAILPIT_VERSION}`
- Default version: `v1.30.0`
- SMTP port: configurable through `MAILPIT_SMTP_PORT`
- UI port: configurable through `MAILPIT_UI_PORT`
- Health check command: `/mailpit readyz`
- Restart policy: `unless-stopped`
- No persistent volume in this foundation phase.

## 6. Environment Contract

`.env.docker.example` contains local-only defaults and version pins:

```dotenv
COMPOSE_PROJECT_NAME=booking-os

POSTGRES_VERSION=17.10
POSTGRES_DB=booking_os
POSTGRES_USER=booking
POSTGRES_PASSWORD=booking
POSTGRES_PORT=5432

REDIS_VERSION=8.8.1-alpine
REDIS_PORT=6379

MINIO_GO_IMAGE_VERSION=1.24.13-alpine3.22
MINIO_ALPINE_VERSION=3.22.5
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

`.env.docker` and `compose.override.yaml` remain untracked. `.env.docker.example` remains tracked.

## 7. Compose Variable Rules

- `${VARIABLE}` is expanded by Docker Compose from `.env.docker`.
- `${VARIABLE:?message}` makes missing required variables fail during Compose interpolation.
- `$$VARIABLE` is preserved as `$VARIABLE` for the shell inside a container.

The PostgreSQL health check therefore uses:

```yaml
pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB
```

The Compose file does not use a shared `env_file` block. Each service receives only the variables it needs through `environment`.

## 8. Operations

Initialize local configuration:

```bash
cp .env.docker.example .env.docker
```

Validate configuration:

```bash
docker compose --env-file .env.docker config
```

Build the source-based MinIO image:

```bash
docker compose --env-file .env.docker build minio
```

Start infrastructure:

```bash
docker compose --env-file .env.docker up -d --build
```

Inspect service state:

```bash
docker compose --env-file .env.docker ps
```

Follow logs:

```bash
docker compose --env-file .env.docker logs -f
```

Stop services while retaining data:

```bash
docker compose --env-file .env.docker down
```

Remove services and local data:

```bash
docker compose --env-file .env.docker down --volumes
```

## 9. Error Handling

- Missing required Compose variables must make `docker compose config` fail.
- Unhealthy services must remain visible as unhealthy in `docker compose ps`.
- The MinIO image build must fail when an exact source revision cannot be resolved or compiled.
- `minio-init` must fail when credentials or bucket creation fail.
- PostgreSQL initialization scripts must stop on SQL errors with `\set ON_ERROR_STOP on`.
- The project must not silently fall back to unpinned image or source versions.

## 10. Testing and Acceptance Criteria

The implementation is accepted when:

1. `docker compose --env-file .env.docker config` succeeds.
2. The custom MinIO image builds from the pinned server and client source revisions.
3. PostgreSQL, Redis, MinIO, and Mailpit reach `healthy` status.
4. `minio-init` exits successfully with code 0.
5. PostgreSQL accepts a connection to `booking_os` with the configured user.
6. Redis responds with `PONG`.
7. The MinIO default bucket exists and is private.
8. Mailpit UI responds on the configured UI port.
9. `docker compose down` preserves named-volume data.
10. `docker compose down --volumes` removes local data.
11. No `.env.docker` file or local data directory is committed.
12. No service uses `latest`, an unpinned build source, or an unpinned base image.

## 11. Out of Scope

- Running the API in Docker.
- Production API Dockerfiles.
- Treating the local MinIO image as a supported production object-storage deployment.
- PostgreSQL application migrations or seed data.
- PostgreSQL readiness integration in the API.
- Redis readiness integration in the API.
- MinIO SDK integration.
- SMTP client integration.
- CI-specific Compose overrides.
- TLS, authentication hardening, backups, or production secret management.

These are separate follow-up commits.