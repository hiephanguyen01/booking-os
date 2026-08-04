# Booking SaaS + Genesis Starter v0.1

Bộ khởi tạo để bắt đầu triển khai **Booking SaaS + Multi-Tenant Marketplace** và đồng thời trích xuất Genesis như một năng lực nội bộ.

## Quyết định nền tảng

1. **Xây Booking trước, trích xuất Genesis sau.**
2. Master Spec V4.0 là baseline nghiệp vụ và kiến trúc.
3. Repository triển khai theo vertical slice, mỗi sprint phải demo end-to-end.
4. Không cắt các quality gate về tenant isolation, double booking, ledger, payment idempotency, backup và operations.
5. Bộ `slavingia/skills` được dùng cho nhánh **business/product**, không thay thế skill kỹ thuật.

## Bắt đầu

```bash
python tools/genesis_cli.py validate
python tools/genesis_cli.py new-adr "Tên quyết định"
```

## Monorepo runtime

### Deployment units

```text
apps/
  api/                NestJS API, port 3001
  web-storefront/     Next.js public storefront, port 3000
  web-console/        Next.js operations console, port 3002
  worker-critical/    BullMQ critical-job worker
  worker-batch/       BullMQ batch-job worker
packages/
  api-client/         Typed health API client
  auth/               Session, role, and permission primitives
  contracts/          Shared API contracts
  i18n/               Typed Vietnamese and English messages
  observability/      Structured JSON logger
  testing/            Deterministic test fixtures
  typescript-config/  Shared strict TypeScript configurations
  ui/                 Shared React components
```

### Local endpoints and queues

| Unit | Endpoint or queue | Notes |
| --- | --- | --- |
| Storefront | `http://localhost:3000` | Public shell; remains available in degraded mode when the API is unavailable |
| API | `http://localhost:3001/api` | Health endpoint: `http://localhost:3001/api/health` |
| Console | `http://localhost:3002` | Demonstration partner session; no real login or cookie storage |
| Critical worker | `booking-critical` | Scaffold `health-check` job only |
| Batch worker | `booking-batch` | Scaffold `health-check` job only |
| Redis | `127.0.0.1:6379` | No username or password by default |

Both web applications read `API_BASE_URL` and `APP_LOCALE` from their deployment-unit environment. The default API base URL is `http://localhost:3001/api`, and unsupported locales fall back to Vietnamese.

### Run applications

Start each deployment unit in a separate terminal:

```bash
pnpm --filter @booking-os/api dev
pnpm --filter @booking-os/web-storefront dev
pnpm --filter @booking-os/web-console dev
pnpm --filter @booking-os/worker-critical dev
pnpm --filter @booking-os/worker-batch dev
```

After Redis and the workers are running, enqueue the scaffold jobs with:

```bash
pnpm --filter @booking-os/worker-critical smoke:enqueue
pnpm --filter @booking-os/worker-batch smoke:enqueue
```

Worker environment defaults:

```dotenv
NODE_ENV=development
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
```

A normal job validation or handler error fails only that BullMQ job. Bootstrap failures and fatal Redis or worker runtime errors set a non-zero process exit state. Worker logs never include Redis credentials.

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
READINESS_TIMEOUT_MS=750
```

`READINESS_TIMEOUT_MS` is validated from `100` through `5000` milliseconds. Copy the complete local template before starting the API:

```bash
cp apps/api/.env.example apps/api/.env
```

`apps/api/.env` is local-only and must not be committed. The MinIO API is available at `http://localhost:9000`, and Mailpit accepts SMTP on `localhost:1025`.

### API health and readiness

```text
GET http://localhost:3001/api/health  -> liveness, HTTP 200 while the API is serving
GET http://localhost:3001/api/ready   -> PostgreSQL + Redis readiness, HTTP 200 or 503
```

`/api/health` does not depend on PostgreSQL or Redis. `/api/ready` runs PostgreSQL `SELECT 1 AS ready` and Redis `PING` in parallel; both dependencies are required. Results, including unavailable results, are cached for one second, and concurrent requests share the same in-flight probe pair.

The API is allowed to start while PostgreSQL or Redis is unavailable. During an outage, liveness remains `200` while readiness returns `503`. The dependency clients reconnect and readiness recovers without restarting the API.

Start the required infrastructure and verify both endpoints:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d postgres redis
cp apps/api/.env.example apps/api/.env
pnpm --filter @booking-os/api dev
curl -i http://localhost:3001/api/health
curl -i http://localhost:3001/api/ready
```

### Request correlation and errors

Every response contains `x-request-id`. A safe upstream value is preserved; a missing or invalid value is replaced with a generated UUID. Request IDs are correlation values only and are not authentication or authorization proof.

Unhandled server errors return a minimal envelope and never expose the internal exception:

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "requestId": "43c2387d-98c8-4e73-9f67-a32f36c945df"
}
```

Client-safe `4xx` messages are retained. The response header and body use the same request ID.

### Structured API events

The API emits these JSON events:

- `http.request_completed`: final route template, status and duration.
- `http.request_failed`: internal exception plus safe request context.
- `readiness.probe_failed`: dependency, duration and safe failure reason.
- `dependency.shutdown_failed`: dependency cleanup failure.

Successful `/api/health` and `/api/ready` calls do not emit `http.request_completed`; unsuccessful readiness and unexpected errors remain visible. Logs exclude request/response bodies, raw query values, cookies, authorization headers, credentials, connection URLs and complete environment objects.

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

## Continuous integration

GitHub Actions runs the unified CI workflow for every pull request and every push to `main`.

The workflow reports six independent checks:

- `quality`: formatting, lint, and TypeScript validation.
- `test`: unit tests.
- `build`: workspace production builds.
- `security`: dependency audit and committed-secret scanning.
- `knowledge`: Genesis artifact validation.
- `docker-config`: Docker Compose interpolation and schema validation.

The dependency audit blocks `high` and `critical` advisories. Gitleaks scans committed history without posting pull-request comments or uploading SARIF artifacts.

Run the equivalent checks locally:

```bash
pnpm install --frozen-lockfile
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level high
python tools/genesis_cli.py validate
cp .env.docker.example .env.docker
pnpm infra:config
```

## Cấu trúc

- `apps/`: sáu deployment units của Booking OS.
- `packages/`: shared contracts, runtime helpers, UI và test utilities.
- `docs/`: kiến trúc, ADR, backlog và kế hoạch delivery.
- `genesis/`: workflow, role, review checklist, template và business skills.
- `schemas/`: schema kiểm tra artifact.
- `tools/`: CLI tối thiểu.
- `.github/workflows/`: unified quality, test, build, security, knowledge, and Docker configuration CI.
