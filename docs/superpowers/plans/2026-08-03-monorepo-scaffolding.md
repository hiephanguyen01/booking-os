# Monorepo Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the runnable Booking OS monorepo skeleton with two Next.js applications, two NestJS/BullMQ workers, six usable shared packages, real package consumers, tests, documentation, and clean CI verification.

**Architecture:** Build framework-independent shared packages first, then wire them into the existing API, two worker deployment units, and two Next.js deployment units. Shared runtime libraries compile to ESM `dist`; `@booking-os/ui` exposes TSX source for Next.js transpilation while emitting declarations. Workers own environment, Redis, queue, and shutdown lifecycle; web applications own environment access and map API failures to degraded UI state.

**Tech Stack:** Node.js 22, pnpm 10.34.5, Turborepo 2.10.7, TypeScript 5.9.3, Biome 2.5.6, Next.js 16.2.12, React 19.2.8, NestJS 11.1.28, BullMQ 5.79.3, ioredis 5.11.1, Zod 4.4.3, Vitest 4.1.10, Node.js test runner.

## Global Constraints

- Work only on branch `chore/monorepo-scaffolding` until the pull request is ready.
- Use Node.js `22` and pnpm `10.34.5`; pin every dependency to an exact version.
- Preserve dependency direction `applications -> shared packages -> contracts/typescript-config`.
- Shared production packages must not import applications or `@booking-os/testing`.
- Shared packages must not read `process.env`, connect to Redis, access a database, or import Next.js.
- `@booking-os/testing` may depend on shared packages and is consumed only by test code.
- Both Next.js pages must export `dynamic = "force-dynamic"`; `next build` must not call the live API.
- Worker queues are exactly `booking-critical` and `booking-batch`; the scaffold job name is exactly `health-check`.
- A handler/validation error fails only its BullMQ job. A bootstrap failure or fatal worker/Redis runtime error sets non-zero process exit state.
- Unit tests must not connect to Redis, PostgreSQL, or a live HTTP server.
- Do not add OpenAPI generation, real authentication, locale routing, OpenTelemetry, Playwright execution, Docker images, deployment, or domain job handlers.
- Include `pnpm-lock.yaml` in every commit that changes a package manifest.

## Reusable Package Conventions

Runtime library packages use this manifest shape, substituting package name and dependency blocks:

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

Runtime library `tsconfig.json`:

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

Worker packages pin these runtime dependencies:

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

Next.js applications pin `next` `16.2.12`, `react`/`react-dom` `19.2.8`, `@types/react` `19.2.17`, and `@types/react-dom` `19.2.3`.

## File Map

- `packages/auth/`: roles, permissions, session contracts, authorization helpers.
- `packages/i18n/`: typed Vietnamese/English dictionaries and locale normalization.
- `packages/observability/`: structured JSON records, child context, error serialization.
- `packages/testing/`: fresh health/session/job/log fixtures and an assertion helper.
- `packages/api-client/`: typed health client, timeout, error taxonomy, runtime validation.
- `packages/ui/`: React `StatusCard`, CSS Module, Vitest render test.
- `apps/api/src/bootstrap-events.ts`: testable API bootstrap event functions.
- `apps/worker-critical/`: critical queue runtime and local smoke producer.
- `apps/worker-batch/`: batch queue runtime and local smoke producer.
- `apps/web-storefront/`: request-time storefront shell on port 3000.
- `apps/web-console/`: request-time console shell on port 3002.
- `README.md` and `docs/backlog/SPRINT-0.md`: runbook and verified completion state.

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
- Consumes: runtime-library conventions above.
- Produces: `ROLES`, `Role`, `PERMISSIONS`, `Permission`, `AuthUser`, `Session`, `ROLE_PERMISSIONS`, `getPermissions(role)`, `hasPermission(session, permission)`.

- [ ] **Step 1: Create package config and failing test**

Use the runtime-library manifest/TS config. Test these assertions before source exports exist:

```ts
assert.equal(hasPermission(platformSession, PERMISSIONS.platformManage), true);
assert.equal(hasPermission(partnerSession, PERMISSIONS.platformManage), false);
assert.equal(hasPermission(null, PERMISSIONS.bookingView), false);
assert.deepEqual(getPermissions(ROLES.affiliate), [PERMISSIONS.affiliateView]);
```

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/auth
```

Expected: FAIL because the authorization API is absent.

- [ ] **Step 3: Implement exact public contracts**

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

export type Role = (typeof ROLES)[keyof typeof ROLES];
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
}

export interface Session {
  readonly user: AuthUser;
  readonly expiresAt: string;
}
```

Permission order:

```text
platform-admin -> platform:manage, tenant:manage, listing:manage, booking:view, affiliate:view
tenant-admin   -> tenant:manage, listing:manage, booking:view
partner        -> listing:manage, booking:view
affiliate      -> affiliate:view
```

Return a fresh array from `getPermissions`. Accept `Session | null | undefined` in `hasPermission`.

- [ ] **Step 4: Verify green state and commit**

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

- [ ] **Step 1: Create package config and failing tests**

```ts
assert.equal(normalizeLocale("vi"), "vi");
assert.equal(normalizeLocale("en-US"), "en");
assert.equal(normalizeLocale("fr"), "vi");
assert.equal(getMessage("en", "storefront.title"), "Booking storefront");
assert.equal(getMessage("vi", "console.title"), "Bảng điều khiển Booking OS");
```

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/i18n
```

Expected: FAIL because locale exports are absent.

- [ ] **Step 3: Implement dictionaries and locale behavior**

Define `LOCALES = ["vi", "en"] as const`; derive `MessageKey` from Vietnamese messages and require English messages to satisfy `Record<MessageKey, string>`. Include exactly:

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

`normalizeLocale(value: string | null | undefined)` lowercases input, takes the segment before `-`, supports `vi`/`en`, and falls back to `vi`. `getMessage` accepts only typed keys.

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

- [ ] **Step 1: Create package config and failing tests**

Add `types: ["node"]` to package compiler options. Test with an array sink and fixed clock:

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

Assert merged context, exact timestamp, omitted `tenantId`, and safe `Error("boom")` serialization.

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/observability
```

Expected: FAIL because logger exports are absent.

- [ ] **Step 3: Implement logger types and behavior**

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

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}
```

`StructuredLogger` exposes `child`, `debug`, `info`, `warn`, and `error(message, error, context?)`. Merge child context first and event context second; remove undefined values; protect `level`, `message`, and `timestamp` from override. Default sink writes one JSON line to stdout. Convert non-Error failures to `{ name: "Error", message: String(value) }`.

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
- Produces: fresh fixture factories and `assertHasOwnKeys`.

- [ ] **Step 1: Create package config and failing tests**

Add runtime workspace dependencies for auth, contracts, and observability. Keep Node types for `node:assert/strict`.

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

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/testing
```

Expected: FAIL after upstream builds because fixture exports are absent.

- [ ] **Step 3: Implement exact fixture defaults**

```text
health: api, ok, 0.1.0, 2026-08-03T12:00:00.000Z, uptime 42
session: user-1, partner@example.com, Partner User, partner
job: job-1, health-check, correlationId corr-1
log: info, job.completed, worker-critical, 2026-08-03T12:00:00.000Z
```

Define `HealthCheckJobFixture` with literal name `health-check`. Accept narrow overrides and clone nested dependencies/user/data on every call. `assertHasOwnKeys` checks a non-null object and own properties only.

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
- Consumes: contracts, Zod `4.4.3`, testing fixtures in tests.
- Produces: `ApiClientError`, `ApiClient`, `createApiClient`.

- [ ] **Step 1: Create package config and failing tests**

Runtime dependencies: contracts workspace and Zod `4.4.3`. Development dependency: testing workspace. Add DOM libs to package compiler options.

Test valid 200 response, HTTP 503, invalid payload, invalid URL, rejected fetch, and abort timeout.

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/api-client
```

Expected: FAIL because the client API is absent.

- [ ] **Step 3: Implement error and client contracts**

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
  readonly health: {
    readonly get: () => Promise<HealthResponse>;
  };
}
```

`ApiClientError` carries code, optional HTTP status, and cause. Assign optional status only when present.

- [ ] **Step 4: Implement runtime validation and fetch behavior**

Build a strict `z.ZodType<HealthResponse>` from `HEALTH_STATUSES`; validate dependency status, optional non-negative latency, and optional message.

Client behavior:

- accept only HTTP(S) base URLs;
- append a trailing slash before resolving `health`, producing `/api/health` from `/api`;
- default timeout `2_000`, positive finite values only;
- use `AbortController`, clear timer in `finally`;
- check `response.ok` before JSON parsing;
- classify abort as timeout and other fetch rejection as network;
- validate JSON and do not retry.

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
- Consumes: React only.
- Produces: `StatusCardState`, `StatusCardProps`, `StatusCard`.

- [ ] **Step 1: Create source-package config and failing render test**

Package exports source for `import` and `dist/index.d.ts` for types. Scripts: declaration-only build, Biome, TypeScript, `vitest run`, rimraf. Pin React/DOM/types and Vitest versions from the header; React is a peer dependency.

```tsx
const html = renderToStaticMarkup(
  <StatusCard title="API status" state="healthy" description="API 0.1.0 is available" />,
);
expect(html).toContain('role="status"');
expect(html).toContain('data-state="healthy"');
```

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/ui
```

Expected: FAIL because `StatusCard` is absent.

- [ ] **Step 3: Implement component, CSS Module, and configs**

```ts
export type StatusCardState = "healthy" | "degraded" | "neutral";

export interface StatusCardProps {
  readonly title: string;
  readonly state: StatusCardState;
  readonly description: string;
  readonly eyebrow?: string;
}
```

Render `<section aria-label={title}>`, optional eyebrow, heading, description, and a visible state node with `role="status"`/`data-state`. Use CSS Module classes for neutral shell and three states. `tsconfig.build.json` emits declarations from `src`; Vitest runs in Node and processes CSS modules.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/ui
test -f packages/ui/dist/index.d.ts
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): add shared status card"
```

---

### Task 7: Wire structured bootstrap events into the API

**Files:**
- Create: `apps/api/src/bootstrap-events.ts`
- Create: `apps/api/src/bootstrap-events.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `StructuredLogger`, `createStructuredLogger`.
- Produces: `service.ready` and `service.bootstrap_failed` API events.

- [ ] **Step 1: Add dependency and failing event test**

Add observability workspace dependency. Test:

```ts
logApiReady(logger, {
  environment: "development",
  address: "http://localhost:3001/api",
});
assert.equal(calls[0]?.message, "service.ready");
logApiBootstrapFailure(logger, new Error("boom"));
assert.equal(calls[1]?.message, "service.bootstrap_failed");
```

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/api
```

Expected: FAIL because event helpers are absent.

- [ ] **Step 3: Implement and wire helpers**

```ts
export function logApiReady(
  logger: StructuredLogger,
  context: { readonly environment: string; readonly address: string },
): void;

export function logApiBootstrapFailure(logger: StructuredLogger, error: unknown): void;
```

Create `createStructuredLogger({ service: "api" })` before bootstrap. Use helper after listen and in top-level catch. Preserve existing shutdown hooks, prefix, host, and port. Add no HTTP middleware.

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
- Produces: service `worker-critical`, queue `booking-critical`, `health-check` processor, graceful shutdown, smoke producer.

- [ ] **Step 1: Create package/config and failing tests**

Scripts:

```json
{
  "dev": "tsx watch src/main.ts",
  "start": "node dist/main.js",
  "build": "tsc -p tsconfig.build.json",
  "lint": "biome check src",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "node --test --import tsx \"src/**/*.test.ts\"",
  "smoke:enqueue": "tsx src/smoke/enqueue-health-check.ts",
  "clean": "rimraf dist tsconfig.tsbuildinfo tsconfig.build.tsbuildinfo"
}
```

Use worker dependencies from the global block; add testing/typescript-config as dev workspaces. Mirror API Nest TS configs. `.env.example` contains NODE_ENV, REDIS_HOST `127.0.0.1`, REDIS_PORT `6379`, empty username/password.

Tests assert default config/literal names, invalid port rejection, valid fixture result, invalid payload rejection plus `job.failed`, and close order `["worker", "redis"]`.

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/worker-critical
```

Expected: FAIL because worker modules are absent.

- [ ] **Step 3: Implement config and processor**

Validate NODE_ENV `development|test|production`, host, port `1..65535`, optional non-empty credentials; normalize empty credentials to absent.

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

Require name `health-check` and strict `{ correlationId: non-empty string }`. Log started/completed; on error log failed and rethrow. Never call `process.exit` in processor code.

- [ ] **Step 4: Implement providers/lifecycle/bootstrap**

Use symbol tokens for config/logger/Redis/worker. Create structured logger, lazy ioredis with `maxRetriesPerRequest: null`, connect, create BullMQ Worker for `booking-critical`, await readiness. Lifecycle closes worker then Redis. Main loads `.env`, creates Nest application context, enables SIGINT/SIGTERM hooks, logs ready, and closes with exit code `1` on fatal worker `error` or bootstrap failure.

- [ ] **Step 5: Implement smoke producer**

Connect to Redis, create Queue `booking-critical`, add one `health-check` with `smoke-${Date.now()}`, print job ID, close queue, quit Redis in `finally`.

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
- Produces: service `worker-batch`, queue `booking-batch`, isolated `health-check` processor, graceful shutdown, smoke producer.

- [ ] **Step 1: Create package/config and failing tests**

Use the full worker dependency block and these scripts:

```json
{
  "dev": "tsx watch src/main.ts",
  "start": "node dist/main.js",
  "build": "tsc -p tsconfig.build.json",
  "lint": "biome check src",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "node --test --import tsx \"src/**/*.test.ts\"",
  "smoke:enqueue": "tsx src/smoke/enqueue-health-check.ts",
  "clean": "rimraf dist tsconfig.tsbuildinfo tsconfig.build.tsbuildinfo"
}
```

Add testing/typescript-config dev workspaces, Nest TS configs, and the exact `.env.example` values documented for the critical worker.

Tests assert service `worker-batch`, queue `booking-batch`, Redis defaults, invalid port rejection, result `{ service: "worker-batch", jobId: "job-1", correlationId: "corr-1" }`, failed-job logging without process exit, and close order worker then Redis.

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/worker-batch
```

Expected: FAIL because worker modules are absent.

- [ ] **Step 3: Implement batch config and processor**

Use exact constants:

```ts
export const SERVICE_NAME = "worker-batch" as const;
export const QUEUE_NAME = "booking-batch" as const;
export const HEALTH_CHECK_JOB_NAME = "health-check" as const;
```

Validate NODE_ENV, Redis host/port/credentials. Define job-like input with optional ID, string name, unknown data; define result with literal batch service. Require strict non-empty correlation ID. Bind job context, log started/completed, log failed and rethrow. Processor contains no exit call.

- [ ] **Step 4: Implement batch providers/lifecycle/bootstrap**

Create local symbol tokens. Create logger service `worker-batch`, lazy ioredis with `maxRetriesPerRequest: null`, connect, create BullMQ Worker on `booking-batch`, and await readiness. Lifecycle closes worker then Redis. Nest main loads `.env`, creates application context, enables SIGINT/SIGTERM, logs ready, and closes with exit code `1` on fatal worker `error` or bootstrap failure. Do not import from `apps/worker-critical`.

- [ ] **Step 5: Implement batch smoke producer**

Connect Redis, create Queue `booking-batch`, add valid `health-check` with `smoke-${Date.now()}`, print ID, close queue, quit Redis in `finally`.

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
- Produces: dynamic storefront on port 3000 and `resolveApiServiceStatus`.

- [ ] **Step 1: Create app/config and failing mapping tests**

Runtime dependencies: API client, i18n, UI workspaces plus pinned Next/React. Scripts use Next dev/start port 3000, Next build, Biome, `tsc --noEmit`, node test, rimraf. `next.config.ts` uses `transpilePackages: ["@booking-os/ui"]`.

`.env.example`:

```dotenv
API_BASE_URL=http://localhost:3001/api
APP_LOCALE=vi
```

Test healthy result `{ state: "healthy", version: "0.1.0" }` and thrown-client result `{ state: "degraded", reason: "API unavailable" }`.

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/web-storefront
```

Expected: FAIL because mapping is absent.

- [ ] **Step 3: Implement config and mapping**

Config defaults API URL and normalizes APP_LOCALE. Define:

```ts
export type ApiServiceStatus =
  | { readonly state: "healthy"; readonly version: string }
  | { readonly state: "degraded"; readonly reason: string };
```

Call `client.health.get`; only contract status `ok` is healthy. Contract degraded/unavailable and thrown errors map to safe degraded text without stack/URL details.

- [ ] **Step 4: Implement dynamic page**

Export `dynamic = "force-dynamic"`. Resolve config/client/status at request time. Render localized title/description and shared `StatusCard`; healthy description includes API version. Add minimal layout metadata and global container/system-font CSS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/web-storefront
git add apps/web-storefront pnpm-lock.yaml
git commit -m "feat(storefront): add runnable Next.js shell"
```

Build must pass while API is stopped.

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
- Produces: dynamic console on port 3002, API status mapping, partner sample session, permission display.

- [ ] **Step 1: Create app/config and failing tests**

Runtime dependencies: auth, API client, i18n, UI workspaces plus pinned Next/React. Scripts use Next dev/start port 3002, Next build, Biome, TypeScript, node test, rimraf. Configure UI transpilation. `.env.example` contains API URL and APP_LOCALE values shown in Task 10.

Mapping tests assert:

```ts
{ state: "healthy", version: "0.1.0" }
{ state: "degraded", reason: "API unavailable" }
```

Session tests assert partner role, listing permission allowed, platform permission denied.

- [ ] **Step 2: Verify red state**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/web-console
```

Expected: FAIL because mapping/session exports are absent.

- [ ] **Step 3: Implement config, mapping, and session**

Define the same explicit discriminated union in this application file:

```ts
export type ApiServiceStatus =
  | { readonly state: "healthy"; readonly version: string }
  | { readonly state: "degraded"; readonly reason: string };
```

Map only `ok` to healthy and every other status/error to safe degraded text.

Create typed session:

```text
id=partner-demo
email=partner@example.com
displayName=Partner Demo
role=partner
expiresAt=2099-01-01T00:00:00.000Z
```

- [ ] **Step 4: Implement dynamic console page**

Export `dynamic = "force-dynamic"`. Render localized title/description, API StatusCard, session name/role, and localized result for `PERMISSIONS.listingManage`. Read no cookie, token, or browser storage. Add minimal metadata/CSS.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/web-console
git add apps/web-console pnpm-lock.yaml
git commit -m "feat(console): add runnable Next.js shell"
```

Build must pass while API is stopped.

---

### Task 12: Document, smoke-test, and close verified foundation items

**Files:**
- Modify: `README.md`
- Modify: `docs/backlog/SPRINT-0.md`
- Modify implementation files only when verification reveals a concrete defect.

**Interfaces:**
- Produces: reproducible runbook, clean verification evidence, accurate backlog state.

- [ ] **Step 1: Update README**

Document workspace tree, ports 3000/3001/3002, API base URL, Redis defaults, queue names, degraded web behavior, and commands:

```bash
pnpm --filter @booking-os/api dev
pnpm --filter @booking-os/web-storefront dev
pnpm --filter @booking-os/web-console dev
pnpm --filter @booking-os/worker-critical dev
pnpm --filter @booking-os/worker-batch dev
pnpm --filter @booking-os/worker-critical smoke:enqueue
pnpm --filter @booking-os/worker-batch smoke:enqueue
```

- [ ] **Step 2: Run clean static verification before backlog changes**

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

Expected: all exit `0`.

- [ ] **Step 3: Smoke API and web applications**

Start API/storefront/console in separate terminals; verify:

```bash
curl --fail http://localhost:3001/api/health
curl --fail http://localhost:3000
curl --fail http://localhost:3002
```

Stop API and verify both web pages still return HTML with degraded state, not HTTP 500.

- [ ] **Step 4: Smoke workers**

```bash
pnpm infra:up
pnpm --filter @booking-os/worker-critical dev
pnpm --filter @booking-os/worker-batch dev
pnpm --filter @booking-os/worker-critical smoke:enqueue
pnpm --filter @booking-os/worker-batch smoke:enqueue
```

Confirm ready/started/completed logs. Send SIGTERM and confirm graceful non-hanging shutdown.

- [ ] **Step 5: Mark exactly four backlog items complete**

```text
[x] Khởi tạo pnpm workspace và Turborepo.
[x] Tạo apps: api, web-storefront, web-console, worker-critical, worker-batch.
[x] Tạo packages: contracts, api-client, ui, i18n, auth, observability, testing.
[x] Docker Compose: PostgreSQL, Redis, MinIO và Mailpit.
```

Leave every other item unchanged.

- [ ] **Step 6: Run final verification**

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

Expected: all exit `0`.

- [ ] **Step 7: Check boundaries**

```bash
rg 'process\.env' packages/api-client packages/auth packages/i18n packages/observability packages/testing packages/ui
rg 'from "next|from "next/' packages
rg '@booking-os/testing' packages/*/src apps/*/src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
rg 'apps/' packages
```

Expected: no matches. Confirm both pages are force-dynamic, both queues have approved names, and no handler calls `process.exit`.

- [ ] **Step 8: Commit and inspect branch**

```bash
git add README.md docs/backlog/SPRINT-0.md
git commit -m "docs: record runnable monorepo foundation"
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
```

Expected: clean tree, one reviewable commit per task, approved scope only.
