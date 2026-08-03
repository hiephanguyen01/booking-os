# Docker Compose Foundation Implementation Plan

> **Execution mode:** Inline execution with checkpoints.

**Goal:** Add a reproducible local Docker Compose stack for PostgreSQL, Redis, source-built MinIO, and Mailpit while the NestJS API continues to run on the host.

**Architecture:** A root-level `compose.yaml` owns local infrastructure only. PostgreSQL, Redis, and MinIO use named volumes and explicit health checks; Mailpit remains ephemeral. MinIO Community is compiled from pinned source revisions into a local non-root image containing both `minio` and `mc`, and a one-shot `minio-init` service creates the private default bucket idempotently.

**Tech Stack:** Docker Compose v2, PostgreSQL 17.10, Redis 8.8.1 Alpine, Go 1.24.13 Alpine builder, Alpine 3.22.5 runtime, MinIO server `RELEASE.2025-10-15T17-29-55Z`, MinIO client `RELEASE.2025-08-13T08-35-41Z`, Mailpit v1.30.0, POSIX shell, SQL.

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

## Version correction checkpoint

Before implementation, update version pins to:

```dotenv
MINIO_GO_IMAGE_VERSION=1.24.13-alpine3.22
MINIO_ALPINE_VERSION=3.22.5
```

Reason: the selected MinIO source revision requires Go toolchain 1.24.8 or newer.

## File Map

- Create `.env.docker.example`
- Modify `.gitignore`
- Create `infra/postgres/init/001-bootstrap.sql`
- Create `infra/minio/Dockerfile`
- Create `infra/minio/create-buckets.sh`
- Create `compose.yaml`
- Modify `package.json`
- Modify `README.md`

## Task execution order

1. Environment contract
2. PostgreSQL bootstrap
3. MinIO source image
4. MinIO bucket bootstrap
5. Compose topology
6. Root infrastructure scripts
7. Runtime verification
8. Volume persistence verification
9. Documentation
10. Final verification

Each task must be verified before moving forward. If verification fails, stop and fix the current task before continuing.
