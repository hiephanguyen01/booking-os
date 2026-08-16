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
pnpm install --frozen-lockfile
pnpm genesis:validate
```

### Genesis artifacts

Các template chuẩn nằm trong `genesis/templates/`. Tạo artifact qua CLI thay vì sao chép Markdown thủ công:

```bash
python tools/genesis_cli.py new-adr "Tên quyết định"
python tools/genesis_cli.py new-feature "Tên tính năng"
python tools/genesis_cli.py new-pattern "Tên pattern"
pnpm genesis:validate
```

ADR bắt đầu ở trạng thái `proposed`; Feature và Pattern bắt đầu ở trạng thái `draft`. Các trạng thái nháp được phép có section chưa hoàn chỉnh và `owner: unassigned`. Artifact `accepted`, `active` hoặc trạng thái lịch sử phải có owner được gán, nội dung thực trong mọi section bắt buộc và không chứa `TODO`, `TBD` hoặc placeholder template.

## Sprint 1B identity access

Platform/Tenant identity-access core đã được chuẩn hóa thành shared kernel thay vì các auth system song song. Canonical feature là [`FEATURE-0002 Identity Access Core`](docs/features/FEATURE-0002-identity-access-core.md), với host-bound opaque-session pattern tại [`PATTERN-0003`](docs/patterns/PATTERN-0003-host-bound-opaque-session.md).

Các invariant chính: Global User dùng chung giữa tenant, opaque session bind exact host/scope, browser không giữ API access token, `__Host-` session cookie + CSRF/Origin, authoritative permission/resource policy + authorization-version reconciliation, transactional security audit, bounded metrics và PostgreSQL FORCE RLS là final tenant boundary. Customer/Partner identity trong các sprint sau phải mở rộng kernel này thay vì tạo hệ thống đăng nhập riêng.

Runbook vận hành:

- [`docs/runbooks/identity-access-recovery.md`](docs/runbooks/identity-access-recovery.md): compromised session, reset/suspension, SMTP/Redis outage, envelope-key rotation, final-owner recovery, audit queries và phased rollout/rollback.
- [`docs/runbooks/platform-admin-bootstrap.md`](docs/runbooks/platform-admin-bootstrap.md): controlled first Platform administrator bootstrap, activation và disable-after-use procedure.

Gate Sprint 1B được chạy bằng `pnpm verify:identity-access` và được nối vào `pnpm verify:foundation`/protected CI.

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
  api-client/         Typed framework-agnostic API client
  auth/               Session, role, and permission primitives
  contracts/          Shared API contracts and committed OpenAPI baseline
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
| Console | `http://localhost:3002` | Operations console with real identity/session, platform provisioning, and tenant membership flows |
| Critical worker | `booking-critical` | Scaffold `health-check` job only |
| Batch worker | `booking-batch` | Scaffold `health-check` job only |
| Redis | `127.0.0.1:6379` | No username or password by default |

Both web applications read `API_BASE_URL` and `APP_LOCALE` from their deployment-unit environment. The default API base URL is `http://localhost:3001/api`, and unsupported locales fall back to Vietnamese.

### Run applications

Generate Prisma Client once, then either start the whole monorepo or run each deployment unit separately:

```bash
pnpm --filter @booking-os/api prisma:generate
pnpm dev
```

For separate terminals, run the generation command above once and then start the units you need:

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

`pnpm infra:down` removes containers but preserves PostgreSQL, Redis, MinIO, and any Caddy named-volume data.

To remove all local infrastructure data:

```bash
pnpm infra:reset
```

This command is destructive.

### Full tenant browser testing with local HTTPS

Normal `pnpm infra:up` remains direct-port HTTP development and does not start Caddy. When you need to test Secure cookies, real platform/tenant hostnames, activation/invitation links, and authenticated tenant mutations end to end, use the opt-in HTTPS profile:

```bash
pnpm infra:https:config
pnpm infra:https:up
```

The complete environment, Caddy CA trust, platform-admin bootstrap, Mailpit, tenant invitation, membership, troubleshooting, and test procedure is documented in [`docs/runbooks/local-https-development.md`](docs/runbooks/local-https-development.md).

### API environment

When the API runs on the host, use:

```dotenv
DATABASE_URL=postgresql://booking:booking@localhost:5432/booking_os
REDIS_URL=redis://localhost:6379/0
READINESS_TIMEOUT_MS=750
TRUST_PROXY=false
TENANT_BASE_DOMAIN=example.com
```

`READINESS_TIMEOUT_MS` is validated from `100` through `5000` milliseconds. `TRUST_PROXY` defaults to `false` and accepts only the literal strings `true` or `false`. Enable it only when the API is behind a configured trusted proxy. `TENANT_BASE_DOMAIN` defaults to `example.com` in development and test, and must be explicitly configured in production. Copy the complete local template before starting the API:

```bash
cp apps/api/.env.example apps/api/.env
```

`apps/api/.env` is local-only and must not be committed. The MinIO API is available at `http://localhost:9000`, and Mailpit accepts SMTP on `localhost:1025`.

For the opt-in HTTPS platform/tenant browser topology, follow `docs/runbooks/local-https-development.md`; it uses `TRUST_PROXY=true`, `TENANT_BASE_DOMAIN=booking.localhost`, and exact HTTPS origins without relaxing CSRF validation.

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

### Tenant isolation and API module boundaries

Tenant identity is resolved only from an allowlisted effective hostname of the form `<tenant>.<TENANT_BASE_DOMAIN>`. Foreign parent domains and nested subdomains fail closed. Request bodies, query parameters, and client-provided tenant, actor, or source headers are never authorization inputs. With `TRUST_PROXY=false`, `Host` is considered only after the base-domain check; with `TRUST_PROXY=true`, only the first `x-forwarded-host` value is considered and it must pass the same check.

The tenancy module follows a Hexagonal boundary:

- controllers call application use cases;
- `TenantResolutionMiddleware` calls `ResolveTenantUseCase`;
- application ports expose technology-neutral capabilities;
- Prisma imports stay under `apps/api/src/modules/*/infrastructure/persistence/prisma`;
- composition roots may bind ports to adapters, but domain and application code may not import NestJS, Prisma, or infrastructure.

Tenant-scoped persistence runs through a capability session:

```ts
return this.transactions.run(context, (session) =>
  session.tenantProbes.list(),
);
```

The application role is `booking_app`, which must remain `NOBYPASSRLS`. Tenant transactions set the role and transaction-local `app.tenant_id` before invoking application work. The critical worker uses the fixed `booking_worker` role through `WorkerDatabase`; callers cannot provide an arbitrary role.

Run the fail-closed architecture and PostgreSQL policy checks with:

```bash
pnpm verify:architecture
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm --filter @booking-os/api verify:tenant-policies
```

`verify:tenant-policies` checks tenant columns, indexes, RLS, FORCE RLS, `USING`, `WITH CHECK`, application-role flags, and table grants from the live PostgreSQL catalog.

### Supported OpenAPI contract

NestJS controllers, DTOs and Swagger decorators are source of truth. Chỉ route được đánh dấu `public-supported` xuất hiện trong contract đã cam kết:

```text
packages/contracts/openapi/openapi.json
packages/api-client/src/generated/schema.ts
packages/api-client/src/generated/client.ts
```

Hiện tại contract hỗ trợ `GET /api/health` và `GET /api/ready`. Tenant probe cùng Foundation diagnostics là internal và không xuất hiện trong contract. Generator không bind cổng, không cần PostgreSQL hoặc Redis khả dụng và không expose Swagger UI hay raw Swagger endpoint.

Sinh lại spec và TypeScript client:

```bash
pnpm api:generate
pnpm api:check-generated
```

Generated files được commit để contract diff có thể review và build không phụ thuộc codegen ẩn. Không chỉnh trực tiếp `openapi.json` hoặc `src/generated/`; thay đổi controller, DTO hoặc generator rồi chạy `pnpm api:generate`. Gate `api:check-generated` sinh lại artifact và fail khi Git tree khác output đã commit.

`@booking-os/api-client` vẫn giữ API public ổn định:

```ts
const client = createApiClient({ baseUrl: "http://localhost:3001/api" });
const health = await client.health.get();
```

Generated TypeScript chỉ cung cấp static typing. Zod vẫn kiểm tra runtime response khi dữ liệu không tin cậy đi qua boundary.

Mọi pull request được kiểm tra bằng gate `OpenAPI compatibility`. CI lấy chính `github.event.pull_request.base.sha`, materialize contract bằng `git show`, rồi so sánh với revision đã commit bằng `oasdiff@v1.17.0`. `ERR` và `WARN` chưa được waiver đều chặn merge; lỗi tool, schema, parser hoặc dữ liệu waiver cũng fail-closed.

Waiver chỉ áp dụng cho đúng cặp SHA-256 contract, đúng severity và đúng dòng finding; owner, lý do và ngày hết hạn là bắt buộc. Quy trình chi tiết nằm tại `docs/api/compatibility-waivers/README.md`.

Kiểm tra fixture bằng binary thật tại local sau khi cài Go 1.26 và `oasdiff` đã pin:

```bash
go install github.com/oasdiff/oasdiff@v1.17.0
pnpm api:verify-compatibility-fixtures
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

For local HTTPS failures, use `pnpm infra:https:logs` and the dedicated local HTTPS runbook instead of disabling TLS, CSRF, tenant resolution, RLS, or secure-cookie behavior.

## Continuous integration

GitHub Actions chạy Foundation CI cùng các Sprint 0 gates cho mọi pull request và mọi push vào `main`.

Các check chính:

- `Quality`: formatting, lint và TypeScript validation.
- `Unit, API E2E, and RLS tests`: unit, API end-to-end và tenant isolation.
- `Migration verification`: migration replay, schema drift và tenant-policy catalog verification.
- `API architecture boundaries`: fail-closed Hexagonal dependency verification.
- `Build`: workspace production builds.
- `Playwright foundation smoke`: storefront, console và API critical smoke.
- `Production configuration guard`: từ chối mock payments trong production.
- `Security`: dependency audit và committed-secret scanning.
- `Knowledge validation`: validation artifact hiện hữu.
- `Docker Compose configuration`: Compose interpolation và schema validation.
- `Genesis tooling`: Python unit tests cùng repository validation.
- `OpenAPI contract`: deterministic regeneration, zero-diff, generated-client typecheck và generator tests.
- `OpenAPI compatibility`: fixture verification bằng `oasdiff` thật và fail-closed comparison với contract tại pull-request base SHA.
- `Identity access acceptance`: `S1B-AC01`–`S1B-AC15` security/RLS/concurrency matrices before Build.

Dependency audit chặn advisory `high` và `critical`. Gitleaks quét committed history mà không đăng PR comment hoặc upload SARIF artifact.

Chạy các gate chính tại local:

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:api
pnpm verify:architecture
pnpm genesis:validate
pnpm api:check-generated
pnpm api:verify-compatibility-fixtures
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm verify:identity-access
pnpm verify:foundation
pnpm build
pnpm audit --audit-level high
python -m unittest discover -s tools/tests -p 'test_*.py' -v
cp .env.docker.example .env.docker
pnpm infra:config
pnpm infra:https:config
```

## Cấu trúc

- `apps/`: năm deployment units của Booking OS.
- `packages/`: shared contracts, runtime helpers, UI và test utilities.
- `docs/`: kiến trúc, ADR, backlog và kế hoạch delivery.
- `genesis/`: workflow, role, review checklist, template và business skills.
- `schemas/`: schema kiểm tra artifact.
- `tools/`: Genesis CLI và validation modules.
- `.github/workflows/`: Foundation CI cùng governance/OpenAPI gates.
