# Monorepo Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the runnable Booking OS monorepo skeleton with two Next.js applications, two NestJS/BullMQ workers, six usable shared packages, real package consumers, tests, documentation, and clean CI verification.

**Architecture:** Implement framework-independent shared packages first, then wire them into the existing API, worker deployment units, and Next.js deployment units. Runtime libraries compile to ESM `dist`; `@booking-os/ui` exposes TSX source for Next.js transpilation while emitting declarations. Workers own environment, Redis, queue, and shutdown lifecycle; web applications own environment access and map API failures to degraded UI state.

**Tech Stack:** Node.js 22, pnpm 10.34.5, Turborepo 2.10.7, TypeScript 5.9.3, Biome 2.5.6, Next.js 16.2.12, React 19.2.8, NestJS 11.1.28, BullMQ 5.79.3, ioredis 5.11.1, Zod 4.4.3, Vitest 4.1.10, Node.js test runner.

## Global Constraints

- Work on branch `chore/monorepo-scaffolding`.
- Use Node.js `22` and pnpm `10.34.5`; pin every dependency exactly.
- Preserve dependency direction `applications -> shared packages -> contracts/typescript-config`.
- Shared production packages must not import applications or `@booking-os/testing`.
- Shared packages must not read `process.env`, connect to Redis, access databases, or import Next.js.
- `@booking-os/testing` is consumed only from tests.
- Both Next.js pages export `dynamic = "force-dynamic"`; builds perform no live API request.
- Worker queues are exactly `booking-critical` and `booking-batch`; scaffold job name is `health-check`.
- Job validation/handler errors fail only their jobs. Bootstrap or fatal worker/Redis errors set non-zero exit state.
- Unit tests connect to no Redis, PostgreSQL, or live HTTP service.
- Do not add OpenAPI generation, real auth, locale routing, OpenTelemetry, Playwright, Docker images, deployment, or domain handlers.
- Include `pnpm-lock.yaml` whenever package manifests change.

## Shared Package Template

Runtime libraries use this manifest shape with the task-specific package name and dependency block:

```json
{
  "name": "@booking-os/package-name",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch",
    "lint": "biome check src tests",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "node --test --import tsx tests/**/*.test.ts",
    "clean": "rimraf dist tsconfig.tsbuildinfo"
  },
  "devDependencies": {
    "@booking-os/typescript-config": "workspace:*",
    "@types/node": "catalog:",
    "rimraf": "6.0.1",
    "tsx": "4.20.5",
    "typescript": "catalog:"
  }
}
```

Runtime library TS config:

```json
{
  "extends": "@booking-os/typescript-config/library.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "tsconfig.tsbuildinfo"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

Worker runtime dependencies:

```json
{
  "@booking-os/observability": "workspace:*",
  "@nestjs/common": "11.1.28",
  "@nestjs/core": "11.1.28",
  "bullmq": "5.79.3",
  "dotenv": "17.4.2",
  "ioredis": "5.11.1",
  "reflect-metadata": "0.2.2",
  "rxjs": "7.8.2",
  "zod": "4.4.3"
}
```

Next.js apps pin `next` `16.2.12`, React/React DOM `19.2.8`, React types `19.2.17`, and React DOM types `19.2.3`.

## File Map

- `packages/auth/`: roles, permissions, sessions, authorization.
- `packages/i18n/`: typed `vi`/`en` messages and locale fallback.
- `packages/observability/`: JSON logger and error serialization.
- `packages/testing/`: fresh health/session/job/log fixtures.
- `packages/api-client/`: typed health fetch client and errors.
- `packages/ui/`: React status card and CSS Module.
- `apps/api/src/bootstrap-events.ts`: structured API bootstrap events.
- `apps/worker-critical/`: critical BullMQ runtime.
- `apps/worker-batch/`: batch BullMQ runtime.
- `apps/web-storefront/`: dynamic storefront shell on port 3000.
- `apps/web-console/`: dynamic console shell on port 3002.
- `README.md`, `docs/backlog/SPRINT-0.md`: runbook and verified status.

---

### Task 1: Add `@booking-os/auth`

**Files:**
- Create: `packages/auth/package.json`
- Create: `packages/auth/tsconfig.json`
- Create: `packages/auth/src/roles.ts`
- Create: `packages/auth/src/permissions.ts`
- Create: `packages/auth/src/session.ts`
- Create: `packages/auth/src/authorization.ts`
- Create: `packages/auth/src/index.ts`
- Create: `packages/auth/tests/authorization.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `ROLES`, `Role`, `PERMISSIONS`, `Permission`, `AuthUser`, `Session`, `ROLE_PERMISSIONS`, `getPermissions`, `hasPermission`.

- [ ] **Step 1: Create package config and failing test**

Use the shared package template. Test:

```ts
assert.equal(hasPermission(platformSession, PERMISSIONS.platformManage), true);
assert.equal(hasPermission(partnerSession, PERMISSIONS.platformManage), false);
assert.equal(hasPermission(null, PERMISSIONS.bookingView), false);
assert.deepEqual(getPermissions(ROLES.affiliate), [PERMISSIONS.affiliateView]);
```

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/auth
```

Expected: FAIL because exports are absent.

- [ ] **Step 3: Implement contracts**

```ts
export const ROLES = {
  platformAdmin: "platform-admin",
  tenantAdmin: "tenant-admin",
  partner: "partner",
  affiliate: "affiliate",
} as const;

export const PERMISSIONS = {
  platformManage: "platform:manage",
  tenantManage: "tenant:manage",
  listingManage: "listing:manage",
  bookingView: "booking:view",
  affiliateView: "affiliate:view",
} as const;
```

Define `AuthUser` (`id`, `email`, `displayName`, `role`) and `Session` (`user`, `expiresAt`). Permission order:

```text
platform-admin -> platform:manage, tenant:manage, listing:manage, booking:view, affiliate:view
tenant-admin   -> tenant:manage, listing:manage, booking:view
partner        -> listing:manage, booking:view
affiliate      -> affiliate:view
```

Return a fresh array from `getPermissions`; `hasPermission` accepts `Session | null | undefined`.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/auth
git add packages/auth pnpm-lock.yaml
git commit -m "feat(auth): add shared authorization primitives"
```

---

### Task 2: Add `@booking-os/i18n`

**Files:**
- Create: `packages/i18n/package.json`
- Create: `packages/i18n/tsconfig.json`
- Create: `packages/i18n/src/messages.ts`
- Create: `packages/i18n/src/locale.ts`
- Create: `packages/i18n/src/index.ts`
- Create: `packages/i18n/tests/i18n.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `LOCALES`, `Locale`, `MessageKey`, `normalizeLocale`, `getMessage`.

- [ ] **Step 1: Create config and failing tests**

```ts
assert.equal(normalizeLocale("vi"), "vi");
assert.equal(normalizeLocale("en-US"), "en");
assert.equal(normalizeLocale("fr"), "vi");
assert.equal(getMessage("en", "storefront.title"), "Booking storefront");
assert.equal(getMessage("vi", "console.title"), "Bảng điều khiển Booking OS");
```

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/i18n
```

- [ ] **Step 3: Implement messages and fallback**

Define `LOCALES = ["vi", "en"] as const`. Derive keys from Vietnamese and require English to satisfy `Record<MessageKey, string>`. Keys:

```text
storefront.title
storefront.description
console.title
console.description
api.status.title
api.status.healthy
api.status.degraded
console.session.title
console.permission.allowed
console.permission.denied
```

Normalize case and language segment before `-`; fallback to `vi`. Message lookup accepts typed keys only.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/i18n
git add packages/i18n pnpm-lock.yaml
git commit -m "feat(i18n): add typed Vietnamese and English messages"
```

---

### Task 3: Add `@booking-os/observability`

**Files:**
- Create: `packages/observability/package.json`
- Create: `packages/observability/tsconfig.json`
- Create: `packages/observability/src/types.ts`
- Create: `packages/observability/src/logger.ts`
- Create: `packages/observability/src/index.ts`
- Create: `packages/observability/tests/logger.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `LogLevel`, `LogContext`, `SerializedError`, `StructuredLogRecord`, `LogSink`, `StructuredLogger`, `createStructuredLogger`.

- [ ] **Step 1: Create config and failing tests**

Add Node types. Use an array sink and fixed clock:

```ts
const logger = createStructuredLogger({
  service: "worker-critical",
  sink: (record) => records.push(record),
  now: () => new Date("2026-08-03T12:00:00.000Z"),
});
logger.child({ jobId: "123", tenantId: undefined }).info("job.completed", {
  jobName: "health-check",
});
```

Assert merged context, timestamp, omitted undefined field, and safe `Error("boom")` serialization.

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/observability
```

- [ ] **Step 3: Implement logger**

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogValue = string | number | boolean | null;

export interface LogContext {
  readonly requestId?: string;
  readonly jobId?: string;
  readonly jobName?: string;
  readonly tenantId?: string;
  readonly service?: string;
  readonly [key: string]: LogValue | undefined;
}
```

Expose child/debug/info/warn/error. Merge child then event context, omit undefined, protect level/message/timestamp, serialize Error name/message/optional stack, convert unknown failures with `String`, and default to one JSON line on stdout.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/observability
git add packages/observability pnpm-lock.yaml
git commit -m "feat(observability): add structured JSON logger"
```

---

### Task 4: Add `@booking-os/testing`

**Files:**
- Create: `packages/testing/package.json`
- Create: `packages/testing/tsconfig.json`
- Create: `packages/testing/src/health-fixture.ts`
- Create: `packages/testing/src/session-fixture.ts`
- Create: `packages/testing/src/job-fixture.ts`
- Create: `packages/testing/src/log-fixture.ts`
- Create: `packages/testing/src/assertions.ts`
- Create: `packages/testing/src/index.ts`
- Create: `packages/testing/tests/fixtures.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: contracts, auth, observability.
- Produces: `createHealthResponseFixture`, `createSessionFixture`, `createHealthCheckJobFixture`, `createLogRecordFixture`, `assertHasOwnKeys`.

- [ ] **Step 1: Create config and failing tests**

Add auth/contracts/observability workspace runtime dependencies and Node types.

```ts
const first = createHealthResponseFixture();
const second = createHealthResponseFixture();
assert.notEqual(first, second);
assert.notEqual(first.dependencies, second.dependencies);
assert.equal(createSessionFixture({ role: ROLES.partner }).user.role, ROLES.partner);
assert.deepEqual(createHealthCheckJobFixture({ correlationId: "corr-123" }), {
  id: "job-1",
  name: "health-check",
  data: { correlationId: "corr-123" },
});
```

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/testing
```

- [ ] **Step 3: Implement fresh fixtures**

Defaults:

```text
health: api, ok, 0.1.0, 2026-08-03T12:00:00.000Z, uptime 42
session: user-1, partner@example.com, Partner User, partner
job: job-1, health-check, correlationId corr-1
log: info, job.completed, worker-critical, 2026-08-03T12:00:00.000Z
```

Define a literal `health-check` fixture interface; accept narrow overrides; clone nested dependencies/user/data. Assertion helper checks non-null object and own keys.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/testing
git add packages/testing pnpm-lock.yaml
git commit -m "test: add shared deterministic fixtures"
```

---

### Task 5: Add `@booking-os/api-client`

**Files:**
- Create: `packages/api-client/package.json`
- Create: `packages/api-client/tsconfig.json`
- Create: `packages/api-client/src/errors.ts`
- Create: `packages/api-client/src/health-schema.ts`
- Create: `packages/api-client/src/client.ts`
- Create: `packages/api-client/src/index.ts`
- Create: `packages/api-client/tests/client.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `ApiClientError`, `ApiClient`, `createApiClient`.

- [ ] **Step 1: Create config and failing tests**

Runtime dependencies: contracts workspace, Zod `4.4.3`; testing workspace as dev dependency. Add DOM libs. Test valid 200, HTTP 503, invalid shape, invalid URL, network rejection, and abort timeout.

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/api-client
```

- [ ] **Step 3: Implement contracts**

```ts
export type ApiClientErrorCode =
  | "invalid_config"
  | "network"
  | "timeout"
  | "http"
  | "invalid_response";

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface ApiClient {
  readonly health: { readonly get: () => Promise<HealthResponse> };
}
```

Error carries code, optional HTTP status, and cause; assign status only when present.

- [ ] **Step 4: Implement validation and fetch**

Create strict `z.ZodType<HealthResponse>` from `HEALTH_STATUSES`. Accept HTTP(S), add trailing base-path slash, resolve `health`, default timeout `2_000`, require positive finite timeout, use AbortController, clear timer, check `response.ok`, validate JSON, classify abort/network, and never retry.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/api-client
git add packages/api-client pnpm-lock.yaml
git commit -m "feat(api-client): add typed health client"
```

---

### Task 6: Add `@booking-os/ui`

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/tsconfig.build.json`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/css-modules.d.ts`
- Create: `packages/ui/src/status-card.tsx`
- Create: `packages/ui/src/status-card.module.css`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/tests/status-card.test.tsx`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `StatusCardState`, `StatusCardProps`, `StatusCard`.

- [ ] **Step 1: Create config and failing render test**

Export TSX source for imports and `dist/index.d.ts` for types. Use declaration-only build and Vitest. Pin React/DOM/types/Vitest versions; React is peer dependency.

```tsx
const html = renderToStaticMarkup(
  <StatusCard title="API status" state="healthy" description="API 0.1.0 is available" />,
);
expect(html).toContain('role="status"');
expect(html).toContain('data-state="healthy"');
```

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/ui
```

- [ ] **Step 3: Implement UI**

```ts
export type StatusCardState = "healthy" | "degraded" | "neutral";

export interface StatusCardProps {
  readonly title: string;
  readonly state: StatusCardState;
  readonly description: string;
  readonly eyebrow?: string;
}
```

Render labelled section, optional eyebrow, heading, description, and role=status node with data-state. CSS Module distinguishes three states. Build emits declarations from `src`; declare CSS module string map.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/ui
test -f packages/ui/dist/index.d.ts
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): add shared status card"
```

---

### Task 7: Wire API bootstrap observability

**Files:**
- Create: `apps/api/src/bootstrap-events.ts`
- Create: `apps/api/src/bootstrap-events.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `service.ready`, `service.bootstrap_failed`.

- [ ] **Step 1: Add dependency and failing test**

Add observability workspace dependency. Test `logApiReady` calls info with environment/address and `logApiBootstrapFailure` calls error with the failure.

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/api
```

- [ ] **Step 3: Implement and wire**

```ts
export function logApiReady(
  logger: StructuredLogger,
  context: { readonly environment: string; readonly address: string },
): void;

export function logApiBootstrapFailure(logger: StructuredLogger, error: unknown): void;
```

Create structured logger service `api` before bootstrap; use helpers after listen and in catch. Preserve existing host/port/prefix/shutdown. Add no request middleware.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/api
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): emit structured bootstrap events"
```

---

### Task 8: Add `worker-critical`

**Files:**
- Create: `apps/worker-critical/package.json`
- Create: `apps/worker-critical/tsconfig.json`
- Create: `apps/worker-critical/tsconfig.build.json`
- Create: `apps/worker-critical/.env.example`
- Create: `apps/worker-critical/src/config/worker-config.ts`
- Create: `apps/worker-critical/src/config/worker-config.test.ts`
- Create: `apps/worker-critical/src/queue/tokens.ts`
- Create: `apps/worker-critical/src/queue/health-check.ts`
- Create: `apps/worker-critical/src/queue/health-check.test.ts`
- Create: `apps/worker-critical/src/queue/providers.ts`
- Create: `apps/worker-critical/src/queue/worker-lifecycle.service.ts`
- Create: `apps/worker-critical/src/queue/worker-lifecycle.service.test.ts`
- Create: `apps/worker-critical/src/app.module.ts`
- Create: `apps/worker-critical/src/main.ts`
- Create: `apps/worker-critical/src/smoke/enqueue-health-check.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: service `worker-critical`, queue `booking-critical`, health processor, shutdown, smoke producer.

- [ ] **Step 1: Create config and failing tests**

Scripts: tsx watch, node dist, tsc build, Biome, no-emit typecheck, node tests, `smoke:enqueue`, rimraf. Add worker runtime dependencies, testing/typescript-config dev dependencies, and API-style Nest TS configs.

```dotenv
NODE_ENV=development
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
```

Tests cover config defaults/names, invalid port, valid result, invalid payload `job.failed`, and close order worker then Redis.

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/worker-critical
```

- [ ] **Step 3: Implement config and processor**

Validate NODE_ENV, host, port `1..65535`, optional credentials; empty credentials become absent.

```ts
export interface HealthCheckJobLike {
  readonly id?: string;
  readonly name: string;
  readonly data: unknown;
}

export interface HealthCheckResult {
  readonly service: "worker-critical";
  readonly jobId: string;
  readonly correlationId: string;
}
```

Require name `health-check` and strict non-empty correlation ID. Bind job context; log started/completed; log failed and rethrow. No processor exit calls.

- [ ] **Step 4: Implement providers, lifecycle, bootstrap**

Use local symbol tokens. Create logger, lazy ioredis `maxRetriesPerRequest: null`, connect, create Worker on `booking-critical`, await readiness. Lifecycle closes worker then Redis. Main loads env, creates Nest context, enables SIGINT/SIGTERM, logs ready, and closes with exit code 1 on fatal worker error/bootstrap failure.

- [ ] **Step 5: Implement smoke producer**

Connect, create Queue `booking-critical`, add valid job with `smoke-${Date.now()}`, print ID, close queue, quit Redis in finally.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/worker-critical
git add apps/worker-critical pnpm-lock.yaml
git commit -m "feat(worker-critical): add BullMQ runtime shell"
```

---

### Task 9: Add `worker-batch`

**Files:**
- Create: `apps/worker-batch/package.json`
- Create: `apps/worker-batch/tsconfig.json`
- Create: `apps/worker-batch/tsconfig.build.json`
- Create: `apps/worker-batch/.env.example`
- Create: `apps/worker-batch/src/config/worker-config.ts`
- Create: `apps/worker-batch/src/config/worker-config.test.ts`
- Create: `apps/worker-batch/src/queue/tokens.ts`
- Create: `apps/worker-batch/src/queue/health-check.ts`
- Create: `apps/worker-batch/src/queue/health-check.test.ts`
- Create: `apps/worker-batch/src/queue/providers.ts`
- Create: `apps/worker-batch/src/queue/worker-lifecycle.service.ts`
- Create: `apps/worker-batch/src/queue/worker-lifecycle.service.test.ts`
- Create: `apps/worker-batch/src/app.module.ts`
- Create: `apps/worker-batch/src/main.ts`
- Create: `apps/worker-batch/src/smoke/enqueue-health-check.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: service `worker-batch`, queue `booking-batch`, health processor, shutdown, smoke producer.

- [ ] **Step 1: Create config and failing tests**

Use worker runtime dependencies; add testing/typescript-config dev dependencies and API-style Nest TS configs. Scripts are tsx watch, node dist, tsc build, Biome, no-emit typecheck, node tests, `smoke:enqueue`, rimraf.

Create exactly:

```dotenv
NODE_ENV=development
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
```

Tests assert service `worker-batch`, queue `booking-batch`, Redis defaults, invalid port, result `{ service: "worker-batch", jobId: "job-1", correlationId: "corr-1" }`, failed-job logging without process exit, and close order worker then Redis.

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/worker-batch
```

- [ ] **Step 3: Implement config and processor**

```ts
export const SERVICE_NAME = "worker-batch" as const;
export const QUEUE_NAME = "booking-batch" as const;
export const HEALTH_CHECK_JOB_NAME = "health-check" as const;
```

Validate NODE_ENV/Redis config. Define job-like input and result with literal batch service. Require strict non-empty correlation ID. Bind context; log started/completed; log failed and rethrow; no exit calls.

- [ ] **Step 4: Implement providers, lifecycle, bootstrap**

Use local tokens. Create logger `worker-batch`, lazy ioredis `maxRetriesPerRequest: null`, connect, create Worker `booking-batch`, await readiness. Lifecycle closes worker then Redis. Nest main loads env, enables SIGINT/SIGTERM, logs ready, and sets exit 1/closes on fatal error. Import nothing from `apps/worker-critical`.

- [ ] **Step 5: Implement smoke producer**

Connect, create Queue `booking-batch`, add valid `health-check` with `smoke-${Date.now()}`, print ID, close queue, quit Redis in finally.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/worker-batch
git add apps/worker-batch pnpm-lock.yaml
git commit -m "feat(worker-batch): add BullMQ runtime shell"
```

---

### Task 10: Add `web-storefront`

**Files:**
- Create: `apps/web-storefront/package.json`
- Create: `apps/web-storefront/tsconfig.json`
- Create: `apps/web-storefront/next-env.d.ts`
- Create: `apps/web-storefront/next.config.ts`
- Create: `apps/web-storefront/.env.example`
- Create: `apps/web-storefront/app/layout.tsx`
- Create: `apps/web-storefront/app/page.tsx`
- Create: `apps/web-storefront/app/globals.css`
- Create: `apps/web-storefront/src/app-config.ts`
- Create: `apps/web-storefront/src/service-status.ts`
- Create: `apps/web-storefront/src/service-status.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: dynamic storefront on port 3000 and API status mapping.

- [ ] **Step 1: Create config and failing tests**

Dependencies: API client/i18n/UI workspaces plus pinned Next/React. Scripts: Next dev/start port 3000, Next build, Biome, tsc no emit, node tests, rimraf. Configure `transpilePackages: ["@booking-os/ui"]`.

```dotenv
API_BASE_URL=http://localhost:3001/api
APP_LOCALE=vi
```

Test healthy `{ state: "healthy", version: "0.1.0" }` and failure `{ state: "degraded", reason: "API unavailable" }`.

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/web-storefront
```

- [ ] **Step 3: Implement config and mapping**

```ts
export type ApiServiceStatus =
  | { readonly state: "healthy"; readonly version: string }
  | { readonly state: "degraded"; readonly reason: string };
```

Default API URL and normalize APP_LOCALE. Only health status `ok` is healthy; every other status/error is safe degraded text without stack/URL.

- [ ] **Step 4: Implement dynamic page**

Export `dynamic = "force-dynamic"`; resolve config/client/status at request time; render localized title/description and StatusCard; healthy description includes version. Add minimal metadata and container/system-font CSS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/web-storefront
git add apps/web-storefront pnpm-lock.yaml
git commit -m "feat(storefront): add runnable Next.js shell"
```

Build while API is stopped.

---

### Task 11: Add `web-console`

**Files:**
- Create: `apps/web-console/package.json`
- Create: `apps/web-console/tsconfig.json`
- Create: `apps/web-console/next-env.d.ts`
- Create: `apps/web-console/next.config.ts`
- Create: `apps/web-console/.env.example`
- Create: `apps/web-console/app/layout.tsx`
- Create: `apps/web-console/app/page.tsx`
- Create: `apps/web-console/app/globals.css`
- Create: `apps/web-console/src/app-config.ts`
- Create: `apps/web-console/src/service-status.ts`
- Create: `apps/web-console/src/service-status.test.ts`
- Create: `apps/web-console/src/sample-session.ts`
- Create: `apps/web-console/src/sample-session.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: dynamic console on port 3002, API mapping, partner sample session, permission display.

- [ ] **Step 1: Create config and failing tests**

Dependencies: auth/API client/i18n/UI workspaces plus pinned Next/React. Scripts: Next dev/start port 3002, Next build, Biome, tsc no emit, node tests, rimraf. Configure UI transpilation.

Create exactly:

```dotenv
API_BASE_URL=http://localhost:3001/api
APP_LOCALE=vi
```

Test healthy/degraded mapping, partner role, listing permission true, platform permission false.

- [ ] **Step 2: Verify failure**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/web-console
```

- [ ] **Step 3: Implement config, mapping, session**

```ts
export type ApiServiceStatus =
  | { readonly state: "healthy"; readonly version: string }
  | { readonly state: "degraded"; readonly reason: string };
```

Map only `ok` healthy. Session:

```text
id=partner-demo
email=partner@example.com
displayName=Partner Demo
role=partner
expiresAt=2099-01-01T00:00:00.000Z
```

- [ ] **Step 4: Implement dynamic page**

Export `dynamic = "force-dynamic"`; render localized shell, API StatusCard, session name/role, localized result for listing permission. Read no cookie/token/storage. Add minimal metadata/CSS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/web-console
git add apps/web-console pnpm-lock.yaml
git commit -m "feat(console): add runnable Next.js shell"
```

Build while API is stopped.

---

### Task 12: Document, smoke-test, and close verified foundation items

**Files:**
- Modify: `README.md`
- Modify: `docs/backlog/SPRINT-0.md`
- Modify implementation files only for concrete verification defects.

**Interfaces:**
- Produces: runbook, verification evidence, accurate backlog state.

- [ ] **Step 1: Update README**

Document tree, ports 3000/3001/3002, API URL, Redis defaults, queue names, degraded web behavior, and:

```bash
pnpm --filter @booking-os/api dev
pnpm --filter @booking-os/web-storefront dev
pnpm --filter @booking-os/web-console dev
pnpm --filter @booking-os/worker-critical dev
pnpm --filter @booking-os/worker-batch dev
pnpm --filter @booking-os/worker-critical smoke:enqueue
pnpm --filter @booking-os/worker-batch smoke:enqueue
```

- [ ] **Step 2: Static verification before backlog update**

```bash
pnpm install --frozen-lockfile
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
pnpm build
python tools/genesis_cli.py validate
cp .env.docker.example .env.docker
pnpm infra:config
```

All exit 0.

- [ ] **Step 3: Smoke API/web**

Start API/storefront/console. Verify:

```bash
curl --fail http://localhost:3001/api/health
curl --fail http://localhost:3000
curl --fail http://localhost:3002
```

Stop API; both web pages still return degraded HTML, not 500.

- [ ] **Step 4: Smoke workers**

```bash
pnpm infra:up
pnpm --filter @booking-os/worker-critical dev
pnpm --filter @booking-os/worker-batch dev
pnpm --filter @booking-os/worker-critical smoke:enqueue
pnpm --filter @booking-os/worker-batch smoke:enqueue
```

Confirm ready/started/completed logs and graceful SIGTERM.

- [ ] **Step 5: Mark exactly four items complete**

```text
[x] Khởi tạo pnpm workspace và Turborepo.
[x] Tạo apps: api, web-storefront, web-console, worker-critical, worker-batch.
[x] Tạo packages: contracts, api-client, ui, i18n, auth, observability, testing.
[x] Docker Compose: PostgreSQL, Redis, MinIO và Mailpit.
```

Leave all others unchanged.

- [ ] **Step 6: Final verification**

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

All exit 0.

- [ ] **Step 7: Boundary scan**

```bash
rg 'process\.env' packages/api-client packages/auth packages/i18n packages/observability packages/testing packages/ui
rg 'from "next|from "next/' packages
rg '@booking-os/testing' packages/*/src apps/*/src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
rg 'apps/' packages
```

No matches. Confirm dynamic pages, approved queues, no handler exit calls.

- [ ] **Step 8: Commit and inspect**

```bash
git add README.md docs/backlog/SPRINT-0.md
git commit -m "docs: record runnable monorepo foundation"
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
```

Expected: clean tree, reviewable history, approved scope only.
