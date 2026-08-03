# Monorepo Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the runnable Booking OS monorepo skeleton with two Next.js applications, two NestJS/BullMQ workers, six usable shared packages, real package consumers, tests, documentation, and clean CI verification.

**Architecture:** Build framework-independent shared packages first, then wire them into the existing API, worker deployment units, and Next.js deployment units. Shared packages compile to ESM `dist` output except `@booking-os/ui`, which exposes TSX source for Next.js transpilation while emitting declarations. Workers own Redis/BullMQ lifecycle; web applications own environment access and map API failures to degraded UI state.

**Tech Stack:** Node.js 22, pnpm 10.34.5, Turborepo 2.10.7, TypeScript 5.9.3, Biome 2.5.6, Next.js 16.2.12, React 19.2.8, NestJS 11.1.28, BullMQ 5.79.3, ioredis 5.11.1, Zod 4.4.3, Vitest 4.1.10, Node.js test runner.

## Global Constraints

- Work only on branch `chore/monorepo-scaffolding` until the pull request is ready.
- Use Node.js `22` and pnpm `10.34.5`; keep every dependency version exact.
- Preserve the dependency direction `applications -> shared packages -> contracts/typescript-config`.
- Shared production packages must not import applications or `@booking-os/testing`.
- Shared packages must not read `process.env`, connect to Redis, access a database, or import Next.js.
- `@booking-os/testing` may depend on shared packages but is consumed only from test code.
- Both Next.js pages must be request-time dynamic so `next build` performs no live API request.
- Both workers use NestJS standalone application contexts, queue names `booking-critical` and `booking-batch`, and one scaffold job named `health-check`.
- A job validation/handler failure fails that BullMQ job and does not terminate the worker process.
- A bootstrap failure or fatal worker/Redis runtime error sets a non-zero process exit code.
- Unit tests must not connect to Redis, PostgreSQL, or a live HTTP server.
- Do not add OpenAPI generation, real authentication, locale routing, OpenTelemetry, Playwright execution, Docker images, deployments, or product-domain handlers.
- Do not mark health/readiness/requestId/structured logging, global environment validation, OpenAPI, or Playwright backlog items complete.
- Include `pnpm-lock.yaml` whenever dependency manifests change.

## File Map

### Shared packages

- `packages/auth/`: session types, role constants, permission mapping, authorization helpers.
- `packages/i18n/`: typed `vi`/`en` dictionaries, locale normalization, message lookup.
- `packages/observability/`: structured JSON logger, child context, safe error serialization.
- `packages/testing/`: fresh fixtures for health, sessions, worker jobs, logs; assertion helper.
- `packages/api-client/`: health API client, bounded timeout, typed error taxonomy, runtime Zod validation.
- `packages/ui/`: framework-independent React `StatusCard`, CSS Module, server-render test.

### Deployment units

- `apps/api/src/bootstrap-events.ts`: testable structured bootstrap events.
- `apps/api/src/main.ts`: existing API bootstrap wired to `@booking-os/observability`.
- `apps/worker-critical/`: critical queue config, processor, BullMQ providers, lifecycle, smoke producer.
- `apps/worker-batch/`: batch queue config, processor, BullMQ providers, lifecycle, smoke producer.
- `apps/web-storefront/`: dynamic Next.js storefront shell and pure API-status mapping.
- `apps/web-console/`: dynamic Next.js console shell, sample session, permission rendering.

### Repository files

- `pnpm-lock.yaml`: exact dependency graph.
- `README.md`: final workspace tree and local run commands.
- `docs/backlog/SPRINT-0.md`: mark only the four delivered foundation items complete.

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
- Consumes: `@booking-os/typescript-config/library.json`.
- Produces: `ROLES`, `Role`, `PERMISSIONS`, `Permission`, `AuthUser`, `Session`, `ROLE_PERMISSIONS`, `hasPermission(session, permission)`, and `getPermissions(role)`.

- [ ] **Step 1: Create the package shell and failing authorization test**

Create a private ESM package with the same build/test conventions as `@booking-os/contracts`:

```json
{
  "name": "@booking-os/auth",
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

Use a library `tsconfig.json` with `rootDir: "src"`, `outDir: "dist"`, and tests excluded. Write tests that import the not-yet-created exports and assert:

```ts
assert.equal(hasPermission(platformSession, PERMISSIONS.platformManage), true);
assert.equal(hasPermission(partnerSession, PERMISSIONS.platformManage), false);
assert.equal(hasPermission(null, PERMISSIONS.bookingView), false);
assert.deepEqual(getPermissions(ROLES.affiliate), [PERMISSIONS.affiliateView]);
```

- [ ] **Step 2: Install and verify the test fails**

Run:

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/auth
```

Expected: FAIL because `../src/index.js` does not yet export the authorization API.

- [ ] **Step 3: Implement exact role, permission, session, and authorization contracts**

Use these runtime values:

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

Define:

```ts
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

Map permissions in deterministic array order:

```ts
platform-admin -> platform:manage, tenant:manage, listing:manage, booking:view, affiliate:view
tenant-admin   -> tenant:manage, listing:manage, booking:view
partner        -> listing:manage, booking:view
affiliate      -> affiliate:view
```

`getPermissions` returns a fresh readonly array. `hasPermission` accepts `Session | null | undefined` and returns `false` for a missing session.

- [ ] **Step 4: Run package verification**

Run:

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/auth
```

Expected: all four tasks PASS.

- [ ] **Step 5: Commit**

```bash
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
- Consumes: shared TypeScript library config.
- Produces: `LOCALES`, `Locale`, `MessageKey`, `normalizeLocale(value)`, `getMessage(locale, key)`, and complete Vietnamese/English dictionaries.

- [ ] **Step 1: Create the package shell and failing locale tests**

Use the same private ESM manifest/scripts as Task 1 with package name `@booking-os/i18n`. Test these exact behaviors:

```ts
assert.equal(normalizeLocale("vi"), "vi");
assert.equal(normalizeLocale("en-US"), "en");
assert.equal(normalizeLocale("fr"), "vi");
assert.equal(getMessage("en", "storefront.title"), "Booking storefront");
assert.equal(getMessage("vi", "console.title"), "Bảng điều khiển Booking OS");
```

- [ ] **Step 2: Install and verify the test fails**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/i18n
```

Expected: FAIL because the locale API does not exist.

- [ ] **Step 3: Implement typed dictionaries and fallback behavior**

Define `LOCALES = ["vi", "en"] as const`. Use the Vietnamese dictionary as the source of `MessageKey`; require the English dictionary to satisfy `Record<MessageKey, string>`.

Include exactly these keys:

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

`normalizeLocale` must accept `string | null | undefined`, normalize case, use the first language segment before `-`, and fall back to `vi`. `getMessage` returns the dictionary value without accepting arbitrary string keys.

- [ ] **Step 4: Run package verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/i18n
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
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
- Consumes: shared TypeScript library config and Node.js stdout.
- Produces: `LogLevel`, `LogContext`, `SerializedError`, `StructuredLogRecord`, `LogSink`, `StructuredLogger`, `createStructuredLogger(options)`.

- [ ] **Step 1: Create the package shell and failing logger tests**

Use the standard private ESM package manifest. Add `"types": ["node"]` in this package's `tsconfig.json`.

Write tests with an injected array sink and fixed clock:

```ts
const records: StructuredLogRecord[] = [];
const logger = createStructuredLogger({
  service: "worker-critical",
  sink: (record) => records.push(record),
  now: () => new Date("2026-08-03T12:00:00.000Z"),
});

logger.child({ jobId: "123", tenantId: undefined }).info("job.completed", {
  jobName: "health-check",
});
```

Assert the record includes level, message, service, jobId, jobName, timestamp; excludes `tenantId`; and serializes an `Error("boom")` into `{ name, message, stack? }`.

- [ ] **Step 2: Install and verify the test fails**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/observability
```

Expected: FAIL because the structured logger API is missing.

- [ ] **Step 3: Implement the logger**

Use these public shapes:

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

export interface StructuredLogRecord extends Readonly<Record<string, unknown>> {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly error?: SerializedError;
}

export type LogSink = (record: StructuredLogRecord) => void;
```

`StructuredLogger` exposes `child(context)`, `debug(message, context?)`, `info`, `warn`, and `error(message, error, context?)`.

Implementation requirements:

- Merge bound context first and event context second.
- Remove entries whose value is `undefined`.
- Add `service` from creation options as bound context.
- Add timestamp and level after context so callers cannot overwrite them.
- Convert non-`Error` failures to `{ name: "Error", message: String(value) }`.
- Default sink writes exactly one `JSON.stringify(record) + "\n"` line to stdout.

- [ ] **Step 4: Run package verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/observability
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
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
- Consumes: `HealthResponse`, auth session types/constants, observability record types.
- Produces: `createHealthResponseFixture`, `createSessionFixture`, `createHealthCheckJobFixture`, `createLogRecordFixture`, `HealthCheckJobFixture`, and `assertHasOwnKeys`.

- [ ] **Step 1: Create the package shell and failing fixture tests**

Package runtime dependencies:

```json
{
  "@booking-os/auth": "workspace:*",
  "@booking-os/contracts": "workspace:*",
  "@booking-os/observability": "workspace:*"
}
```

Add Node types because the assertion helper uses `node:assert/strict`.

Tests must prove:

```ts
const first = createHealthResponseFixture();
const second = createHealthResponseFixture();
assert.notEqual(first, second);
assert.notEqual(first.dependencies, second.dependencies);

const session = createSessionFixture({ role: ROLES.partner });
assert.equal(session.user.role, ROLES.partner);

const job = createHealthCheckJobFixture({ correlationId: "corr-123" });
assert.deepEqual(job, {
  id: "job-1",
  name: "health-check",
  data: { correlationId: "corr-123" },
});
```

- [ ] **Step 2: Install and verify the test fails**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/testing
```

Expected: upstream packages build, then the testing package FAILS because fixture exports are absent.

- [ ] **Step 3: Implement fresh fixtures and assertion helper**

Defaults:

```text
health service=api, status=ok, version=0.1.0, timestamp=2026-08-03T12:00:00.000Z, uptimeSeconds=42
session user id=user-1, email=partner@example.com, displayName=Partner User, role=partner
health job id=job-1, name=health-check, correlationId=corr-1
log level=info, message=job.completed, service=worker-critical, timestamp=2026-08-03T12:00:00.000Z
```

Accept narrow override objects. Clone nested `dependencies`, `user`, and `data` values on every call. Do not freeze global singleton fixtures.

Define:

```ts
export interface HealthCheckJobFixture {
  readonly id: string;
  readonly name: "health-check";
  readonly data: {
    readonly correlationId: string;
  };
}
```

`assertHasOwnKeys(value, keys)` must assert that the value is a non-null object and each requested key is an own property.

- [ ] **Step 4: Run package verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/testing
```

Expected: PASS with upstream dependency builds.

- [ ] **Step 5: Commit**

```bash
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
- Consumes: `HealthResponse`, `HEALTH_STATUSES`, Zod, and health fixtures from `@booking-os/testing` in tests only.
- Produces: `ApiClientErrorCode`, `ApiClientError`, `ApiClientOptions`, `ApiClient`, and `createApiClient(options)` with `client.health.get(): Promise<HealthResponse>`.

- [ ] **Step 1: Create the package shell and failing client tests**

Runtime dependencies:

```json
{
  "@booking-os/contracts": "workspace:*",
  "zod": "4.4.3"
}
```

Development dependencies include `@booking-os/testing: workspace:*`, shared TypeScript config, Node types, rimraf, tsx, and TypeScript. Add `"lib": ["ES2022", "DOM", "DOM.Iterable"]` to its TypeScript compiler options.

Tests cover:

1. Valid `200` JSON returns `createHealthResponseFixture()`.
2. `503` throws `ApiClientError` with code `http` and status `503`.
3. Invalid JSON shape throws code `invalid_response`.
4. Invalid base URL throws code `invalid_config` during client creation.
5. Rejected fetch throws code `network`.
6. A fetch that rejects when its signal aborts throws code `timeout`.

- [ ] **Step 2: Install and verify the tests fail**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/api-client
```

Expected: FAIL because the client API does not exist.

- [ ] **Step 3: Implement the typed error taxonomy**

Use:

```ts
export type ApiClientErrorCode =
  | "invalid_config"
  | "network"
  | "timeout"
  | "http"
  | "invalid_response";

export class ApiClientError extends Error {
  readonly code: ApiClientErrorCode;
  readonly status?: number;
}
```

Set `status` only when a number is provided so `exactOptionalPropertyTypes` remains satisfied. Preserve the original failure through `Error` cause.

- [ ] **Step 4: Implement runtime health validation**

Create a strict Zod schema using `HEALTH_STATUSES`. Type it as `z.ZodType<HealthResponse>` so compile time checks the parsed shape against the contract. Validate dependency records with status, optional non-negative latency, and optional message.

- [ ] **Step 5: Implement `createApiClient`**

Use this public shape:

```ts
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

Behavior:

- Parse and restrict base URL protocols to `http:` or `https:`.
- Append a trailing slash to the base path before resolving `health`; `http://localhost:3001/api` must produce `http://localhost:3001/api/health`.
- Default timeout is `2_000` milliseconds and must be a positive finite number.
- Use `AbortController` and always clear the timer.
- Check `response.ok` before parsing JSON.
- Parse JSON, validate with the schema, and return the typed value.
- Detect an aborted controller as `timeout`; classify other fetch rejections as `network`.
- Do not retry.

- [ ] **Step 6: Run package verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/api-client
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
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
- Consumes: React only; no Next.js imports.
- Produces: `StatusCardState`, `StatusCardProps`, and `StatusCard`.

- [ ] **Step 1: Create the UI package shell and failing render test**

Use these package entry points:

```json
{
  "main": "./src/index.ts",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./src/index.ts"
    }
  },
  "files": ["src", "dist"]
}
```

Scripts:

```json
{
  "build": "tsc -p tsconfig.build.json",
  "lint": "biome check src tests vitest.config.ts",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "vitest run",
  "clean": "rimraf dist tsconfig.tsbuildinfo tsconfig.build.tsbuildinfo"
}
```

Pin `react` and `react-dom` to `19.2.8`, `@types/react` to `19.2.17`, `@types/react-dom` to `19.2.3`, and `vitest` to `4.1.10`. Declare React `19.2.8` as a peer dependency.

Test using `renderToStaticMarkup`:

```tsx
const html = renderToStaticMarkup(
  <StatusCard
    title="API status"
    state="healthy"
    description="API 0.1.0 is available"
  />,
);

expect(html).toContain("API status");
expect(html).toContain("API 0.1.0 is available");
expect(html).toContain('role="status"');
expect(html).toContain('data-state="healthy"');
```

- [ ] **Step 2: Install and verify the test fails**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/ui
```

Expected: FAIL because `StatusCard` is missing.

- [ ] **Step 3: Implement the component and CSS Module**

Use:

```ts
export type StatusCardState = "healthy" | "degraded" | "neutral";

export interface StatusCardProps {
  readonly title: string;
  readonly state: StatusCardState;
  readonly description: string;
  readonly eyebrow?: string;
}
```

Render a semantic `<section aria-label={title}>`, optional eyebrow, heading, description, and a visible state element with `role="status"` and `data-state={state}`. CSS must provide a neutral card shell and distinguish all three states without product-specific layout assumptions.

Configure the main TS config for `jsx: "react-jsx"`, source/tests typecheck, and no emit. Configure the build TS config for `rootDir: "src"`, `outDir: "dist"`, declarations, and `emitDeclarationOnly: true`. Declare `*.module.css` as a readonly string map.

- [ ] **Step 4: Run package verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/ui
```

Expected: PASS; `dist/index.d.ts` exists and tests process the CSS Module through Vitest.

- [ ] **Step 5: Commit**

```bash
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
- Consumes: `StructuredLogger` and `createStructuredLogger`.
- Produces: API events `service.ready` and `service.bootstrap_failed`; no request middleware.

- [ ] **Step 1: Add the dependency and failing bootstrap-event test**

Add `"@booking-os/observability": "workspace:*"` to API dependencies.

Test a pure helper with a fake logger:

```ts
logApiReady(logger, {
  environment: "development",
  address: "http://localhost:3001/api",
});

assert.deepEqual(calls[0], {
  method: "info",
  message: "service.ready",
  context: {
    environment: "development",
    address: "http://localhost:3001/api",
  },
});
```

Also verify `logApiBootstrapFailure(logger, error)` calls `logger.error("service.bootstrap_failed", error)`.

- [ ] **Step 2: Install and verify the test fails**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/api
```

Expected: FAIL because bootstrap event helpers do not exist.

- [ ] **Step 3: Implement helpers and update `main.ts`**

Create exact helper signatures:

```ts
export function logApiReady(
  logger: StructuredLogger,
  context: { readonly environment: string; readonly address: string },
): void;

export function logApiBootstrapFailure(logger: StructuredLogger, error: unknown): void;
```

In `main.ts`, create one logger before bootstrap:

```ts
const bootstrapLogger = createStructuredLogger({ service: "api" });
```

Use it after `app.listen` and inside the top-level catch. Preserve the existing Nest application creation, shutdown hooks, global prefix, host, and port behavior. Do not add HTTP request logging or request IDs.

- [ ] **Step 4: Run API and root verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
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
- Consumes: NestJS application context, BullMQ, ioredis, Zod, observability logger, testing fixtures in tests.
- Produces: service `worker-critical`, queue `booking-critical`, job `health-check`, `processHealthCheckJob(job, logger)`, and `smoke:enqueue`.

- [ ] **Step 1: Create the worker package shell**

Use scripts:

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

Runtime dependencies:

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

Development dependencies include testing/typescript-config workspaces, Node types, rimraf, tsx, and TypeScript. Mirror API NestJS TS config and build config.

`.env.example`:

```dotenv
NODE_ENV=development
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=
```

- [ ] **Step 2: Write failing configuration, processor, and lifecycle tests**

Configuration tests:

```ts
const config = loadWorkerConfig({});
assert.equal(config.service, "worker-critical");
assert.equal(config.queueName, "booking-critical");
assert.equal(config.redis.host, "127.0.0.1");
assert.equal(config.redis.port, 6379);
assert.throws(() => loadWorkerConfig({ REDIS_PORT: "70000" }));
```

Processor tests use `createHealthCheckJobFixture()` and an injected logger sink. Assert valid output:

```ts
{
  service: "worker-critical",
  jobId: "job-1",
  correlationId: "corr-1"
}
```

Assert an empty correlation ID rejects, emits `job.failed`, and does not call `process.exit`.

Lifecycle test passes fake resources and asserts close order `worker`, then `redis`.

- [ ] **Step 3: Install and verify tests fail**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/worker-critical
```

Expected: FAIL because worker implementation files are missing.

- [ ] **Step 4: Implement configuration and health processor**

`loadWorkerConfig(env: NodeJS.ProcessEnv = process.env)` validates:

- `NODE_ENV`: `development | test | production`, default `development`.
- host: non-empty, default `127.0.0.1`.
- port: integer `1..65535`, default `6379`.
- username/password: optional non-empty strings; empty strings normalize to absent.

The returned object includes literal service and queue names.

Define:

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

`processHealthCheckJob` must:

- bind `jobId` and `jobName` context;
- require name `health-check`;
- validate strict data `{ correlationId: non-empty string }`;
- log `job.started`, then `job.completed`;
- on error log `job.failed` and rethrow so BullMQ marks only that job failed.

- [ ] **Step 5: Implement BullMQ providers and lifecycle**

Export symbol tokens for config, logger, Redis connection, and queue worker.

Provider behavior:

1. Create structured logger with service `worker-critical`.
2. Create `new Redis` with `lazyConnect: true` and `maxRetriesPerRequest: null`.
3. Connect Redis.
4. Create `new Worker("booking-critical", processor, { connection })`.
5. Await `worker.waitUntilReady()` before provider resolution.

`WorkerLifecycleService.onApplicationShutdown(signal)` logs shutdown, awaits `worker.close()`, then awaits `redis.quit()`. The service must be directly constructible with `Pick<Worker, "close">` and `Pick<Redis, "quit">` test doubles.

- [ ] **Step 6: Implement Nest bootstrap and fatal runtime handling**

`AppModule` registers all providers and lifecycle service. `main.ts` must:

```ts
import "reflect-metadata";
loadDotenv({ path: process.env.ENV_FILE ?? ".env" });
const app = await NestFactory.createApplicationContext(AppModule);
app.enableShutdownHooks(["SIGINT", "SIGTERM"]);
```

After resolving the worker and logger, log `service.ready`. Attach an `error` listener that logs `worker.runtime_failed`, sets `process.exitCode = 1`, and closes the app. Top-level bootstrap failure logs `service.bootstrap_failed` and sets exit code `1`.

Do not terminate on processor rejection; BullMQ owns that job failure path.

- [ ] **Step 7: Implement the smoke producer**

The script loads the same config, connects Redis, creates `Queue("booking-critical")`, adds one `health-check` job with correlation ID `smoke-${Date.now()}`, prints the queued job ID, closes the queue, then quits Redis in `finally`.

- [ ] **Step 8: Run worker verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/worker-critical
```

Expected: PASS without a running Redis instance.

- [ ] **Step 9: Commit**

```bash
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
- Consumes: the same public libraries as the critical worker, without importing the critical worker application.
- Produces: service `worker-batch`, queue `booking-batch`, isolated BullMQ lifecycle, and `smoke:enqueue`.

- [ ] **Step 1: Create the batch package shell and failing tests**

Use the exact dependency versions and scripts listed for the critical worker, changing only the package name to `@booking-os/worker-batch`.

Tests assert:

```ts
const config = loadWorkerConfig({});
assert.equal(config.service, "worker-batch");
assert.equal(config.queueName, "booking-batch");
```

A valid health job returns:

```ts
{
  service: "worker-batch",
  jobId: "job-1",
  correlationId: "corr-1"
}
```

An invalid job logs `job.failed` and rejects without changing process exit state. Lifecycle order remains worker close, then Redis quit.

- [ ] **Step 2: Install and verify tests fail**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/worker-batch
```

Expected: FAIL because implementation is absent.

- [ ] **Step 3: Implement the batch-specific runtime**

Create a standalone implementation with these exact constants:

```ts
export const SERVICE_NAME = "worker-batch" as const;
export const QUEUE_NAME = "booking-batch" as const;
export const HEALTH_CHECK_JOB_NAME = "health-check" as const;
```

Implement strict worker config, structured logging, health payload validation, BullMQ worker provider, Redis provider, lifecycle service, and fatal runtime listener using the same public behavior specified in Task 8 but with batch constants. Do not import files from `apps/worker-critical`.

- [ ] **Step 4: Implement the batch smoke producer**

Load the batch config, connect Redis, enqueue one valid `health-check` job on `booking-batch`, print its ID, close queue, and quit Redis in `finally`.

- [ ] **Step 5: Run worker verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/worker-batch
```

Expected: PASS without Redis.

- [ ] **Step 6: Commit**

```bash
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
- Consumes: API client, i18n, UI, Next.js, React.
- Produces: dynamic storefront shell on port `3000`, default API base `http://localhost:3001/api`, and pure `resolveApiServiceStatus(client)` mapping.

- [ ] **Step 1: Create the Next.js package shell and failing service-status tests**

Runtime dependencies:

```json
{
  "@booking-os/api-client": "workspace:*",
  "@booking-os/i18n": "workspace:*",
  "@booking-os/ui": "workspace:*",
  "next": "16.2.12",
  "react": "19.2.8",
  "react-dom": "19.2.8"
}
```

Scripts:

```json
{
  "dev": "next dev --hostname 0.0.0.0 --port 3000",
  "start": "next start --hostname 0.0.0.0 --port 3000",
  "build": "next build",
  "lint": "biome check app src next.config.ts next-env.d.ts",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "node --test --import tsx \"src/**/*.test.ts\"",
  "clean": "rimraf .next tsconfig.tsbuildinfo"
}
```

Development dependencies include TypeScript config workspace, Node/React types at exact versions, rimraf, tsx, and TypeScript.

`next.config.ts` sets:

```ts
const nextConfig: NextConfig = {
  transpilePackages: ["@booking-os/ui"],
};
```

`.env.example`:

```dotenv
API_BASE_URL=http://localhost:3001/api
APP_LOCALE=vi
```

Write tests with fake `ApiClient` objects:

```ts
assert.deepEqual(await resolveApiServiceStatus(healthyClient), {
  state: "healthy",
  version: "0.1.0",
});

assert.deepEqual(await resolveApiServiceStatus(failingClient), {
  state: "degraded",
  reason: "API unavailable",
});
```

- [ ] **Step 2: Install and verify the test fails**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/web-storefront
```

Expected: FAIL because service-status mapping is absent.

- [ ] **Step 3: Implement app config and service status mapping**

`resolveStorefrontConfig(env)` returns:

```ts
{
  apiBaseUrl: env.API_BASE_URL ?? "http://localhost:3001/api",
  locale: normalizeLocale(env.APP_LOCALE),
}
```

Define:

```ts
export type ApiServiceStatus =
  | { readonly state: "healthy"; readonly version: string }
  | { readonly state: "degraded"; readonly reason: string };
```

`resolveApiServiceStatus` calls `client.health.get()`. Treat contract status `ok` as healthy. Treat degraded/unavailable contract status and every thrown client error as degraded. Do not expose stack traces or URLs in the displayed reason.

- [ ] **Step 4: Implement the dynamic storefront page**

At module scope:

```ts
export const dynamic = "force-dynamic";
```

At request time, resolve config, create client, fetch status, select localized messages, and render `StatusCard`. Healthy description includes the API version; degraded description uses the localized degraded message. Add a minimal metadata object and root layout. Global CSS supplies page background, container width, spacing, and system font only.

- [ ] **Step 5: Run storefront verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/web-storefront
```

Expected: PASS while the API is stopped; build output must not contain a connection-refused failure.

- [ ] **Step 6: Commit**

```bash
git add apps/web-storefront pnpm-lock.yaml
git commit -m "feat(storefront): add runnable Next.js shell"
```

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
- Consumes: auth, API client, i18n, UI, Next.js, React.
- Produces: dynamic console shell on port `3002`, sample partner session, and listing permission result.

- [ ] **Step 1: Create the Next.js package shell and failing tests**

Use the storefront dependency/script set plus `"@booking-os/auth": "workspace:*"`; change dev/start port to `3002` and package name to `@booking-os/web-console`.

Write the same healthy/degraded service-status tests. Add a sample-session test:

```ts
assert.equal(SAMPLE_SESSION.user.role, ROLES.partner);
assert.equal(hasPermission(SAMPLE_SESSION, PERMISSIONS.listingManage), true);
assert.equal(hasPermission(SAMPLE_SESSION, PERMISSIONS.platformManage), false);
```

- [ ] **Step 2: Install and verify tests fail**

```bash
pnpm install
pnpm exec turbo run test --filter=@booking-os/web-console
```

Expected: FAIL because console mapping and sample session are absent.

- [ ] **Step 3: Implement config, status mapping, and sample session**

Use API base `http://localhost:3001/api`, `APP_LOCALE` normalized by i18n, and the same discriminated service status as storefront.

Define `SAMPLE_SESSION` as a `Session` with:

```text
id=partner-demo
email=partner@example.com
displayName=Partner Demo
role=partner
expiresAt=2099-01-01T00:00:00.000Z
```

The far-future date prevents the static demonstration object from appearing expired; no session validation or persistence is added.

- [ ] **Step 4: Implement the dynamic console page**

Set `export const dynamic = "force-dynamic"`. Render:

- localized console title and description;
- API `StatusCard`;
- session display name and role;
- localized allowed/denied text for `PERMISSIONS.listingManage`.

The page reads no cookie, token, or browser storage. Add minimal layout metadata and global CSS.

- [ ] **Step 5: Run console verification**

```bash
pnpm exec turbo run lint typecheck test build --filter=@booking-os/web-console
```

Expected: PASS while API is stopped.

- [ ] **Step 6: Commit**

```bash
git add apps/web-console pnpm-lock.yaml
git commit -m "feat(console): add runnable Next.js shell"
```

---

### Task 12: Document, smoke-test, and close Sprint 0 foundation items

**Files:**
- Modify: `README.md`
- Modify: `docs/backlog/SPRINT-0.md`
- Modify only when verification reveals required corrections: files created in Tasks 1–11

**Interfaces:**
- Consumes: all application scripts, package exports, Docker Compose infrastructure, API health route.
- Produces: reproducible local runbook and verified backlog status.

- [ ] **Step 1: Update README workspace documentation**

Document the final deployment units and shared packages. Add exact commands:

```bash
pnpm --filter @booking-os/api dev
pnpm --filter @booking-os/web-storefront dev
pnpm --filter @booking-os/web-console dev
pnpm --filter @booking-os/worker-critical dev
pnpm --filter @booking-os/worker-batch dev
pnpm --filter @booking-os/worker-critical smoke:enqueue
pnpm --filter @booking-os/worker-batch smoke:enqueue
```

Record ports `3000` storefront, `3001` API, `3002` console; API base `http://localhost:3001/api`; Redis defaults `127.0.0.1:6379`; queue names; and that web pages render degraded state when API is unavailable.

- [ ] **Step 2: Run clean static verification before changing backlog**

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

Expected: every command exits `0`.

- [ ] **Step 3: Run API and web runtime smoke checks**

In separate terminals:

```bash
pnpm --filter @booking-os/api dev
pnpm --filter @booking-os/web-storefront dev
pnpm --filter @booking-os/web-console dev
```

Verify:

```bash
curl --fail http://localhost:3001/api/health
curl --fail http://localhost:3000
curl --fail http://localhost:3002
```

Stop the API, request both web pages again, and confirm they still return HTML containing degraded status rather than HTTP `500`.

- [ ] **Step 4: Run worker runtime smoke checks**

Start Redis through existing infrastructure, then run workers and producers:

```bash
pnpm infra:up
pnpm --filter @booking-os/worker-critical dev
pnpm --filter @booking-os/worker-batch dev
pnpm --filter @booking-os/worker-critical smoke:enqueue
pnpm --filter @booking-os/worker-batch smoke:enqueue
```

Confirm each worker logs `service.ready`, `job.started`, and `job.completed` with the expected service, queue/job identity, and job ID. Send `SIGTERM` to each worker and confirm shutdown logs occur without hanging.

- [ ] **Step 5: Mark only verified backlog items complete**

Change exactly these items to checked:

```text
[x] Khởi tạo pnpm workspace và Turborepo.
[x] Tạo apps: api, web-storefront, web-console, worker-critical, worker-batch.
[x] Tạo packages: contracts, api-client, ui, i18n, auth, observability, testing.
[x] Docker Compose: PostgreSQL, Redis, MinIO và Mailpit.
```

Leave every other unchecked item unchanged.

- [ ] **Step 6: Re-run final clean verification**

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

Expected: all commands exit `0` from a clean checkout state.

- [ ] **Step 7: Review dependency and boundary invariants**

Run:

```bash
rg 'process\.env' packages/api-client packages/auth packages/i18n packages/observability packages/testing packages/ui
rg 'from "next|from "next/' packages
rg '@booking-os/testing' packages/*/src apps/*/src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
rg 'apps/' packages
```

Expected:

- first command has no matches;
- second command has no matches;
- third command has no production-code matches;
- fourth command has no package-to-app imports.

Also confirm both web pages export `dynamic = "force-dynamic"`, both worker queues use the approved names, and no job-handler path calls `process.exit`.

- [ ] **Step 8: Commit documentation and verified backlog state**

```bash
git add README.md docs/backlog/SPRINT-0.md
git commit -m "docs: record runnable monorepo foundation"
```

- [ ] **Step 9: Inspect final branch history and diff**

```bash
git status --short
git log --oneline --decorate main..HEAD
git diff --stat main...HEAD
```

Expected: clean working tree, one reviewable commit per task, and changes limited to the approved scaffolding, documentation, lockfile, API bootstrap integration, and backlog state.
