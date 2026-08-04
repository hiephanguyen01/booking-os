# API Observability and Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Sprint 0 API runtime foundation with safe request-ID propagation, structured HTTP/error logging, real PostgreSQL and Redis readiness probes, bounded caching, deterministic tests, and verified recovery behavior.

**Architecture:** Add a global `ObservabilityModule` for HTTP transport concerns, a `DependenciesModule` for lazy singleton clients and isolated probes, and a `HealthModule` readiness coordinator that consumes probe abstractions. Preserve the existing shared `HealthResponse` and `StructuredLogger` contracts; do not introduce an ORM, a second logger, tracing, metrics, or a health framework.

**Tech Stack:** Node.js 22, TypeScript 5.9, NestJS 11.1.28 with Express 5, `pg` 8.22.0, `ioredis` 5.11.1, Zod 4.4.3, Node test runner, Supertest, pnpm 10.34.5, Turborepo, Docker Compose, GitHub Actions.

## Global Constraints

- `GET /api/health` is process liveness only and remains HTTP `200` during PostgreSQL or Redis outages.
- `GET /api/ready` is HTTP `200` only when both `SELECT 1` and `PING` succeed; otherwise it returns HTTP `503` with the existing `HealthResponse` body.
- `READINESS_TIMEOUT_MS` defaults to `750` and accepts only integers from `100` through `5000`.
- Readiness results, including unavailable results, are cached for exactly `1000ms`; simultaneous callers share one in-flight probe run.
- Accept upstream `x-request-id` only when it matches `^[A-Za-z0-9._:-]{1,128}$`; otherwise replace it with `crypto.randomUUID()`.
- Every response returns `x-request-id`; normalized error bodies contain the same value.
- Ordinary requests emit one `http.request_completed`; escaped exceptions also emit one `http.request_failed`.
- Successful `/api/health` and `/api/ready` responses do not emit `http.request_completed`; readiness `503` does.
- Never log request/response bodies, raw query values, cookies, authorization headers, client URLs, credentials, IP addresses, or user agents.
- Public dependency failure messages are limited to `timeout`, `connection_failed`, and `unexpected_response`.
- API bootstrap must not connect eagerly to PostgreSQL or Redis and must succeed while either target is unreachable.
- Do not add OpenTelemetry, Prometheus, `@nestjs/terminus`, `nestjs-pino`, authentication, tenancy, an ORM, migrations, Kubernetes resources, or custom-domain routing.
- Keep the API package private ESM and follow the repository's exact-version dependency convention.
- Use NestJS 11 / Express 5 named middleware wildcard `"{*splat}"`, not the legacy bare `"*"` route.
- Do not mark the Sprint 0 backlog item complete until clean verification, runtime smoke, security checks, and unified CI pass.

---

## File Map

### Configuration and package metadata

- Modify `apps/api/package.json`: add runtime/type dependencies and make the standard API `test` script include deterministic e2e tests.
- Modify `pnpm-lock.yaml`: lock the exact dependency graph.
- Modify `apps/api/src/config/environment.schema.ts`: validate and transform `READINESS_TIMEOUT_MS`.
- Modify `apps/api/src/config/environment.schema.test.ts`: cover default, valid, minimum, maximum, and rejection cases.
- Modify `apps/api/src/config/environment.service.ts`: expose `readinessTimeoutMs`.
- Modify `apps/api/.env.example`: document `READINESS_TIMEOUT_MS=750`.

### HTTP observability

- Create `apps/api/src/observability/tokens.ts`: logger, request-ID generator, and monotonic-clock injection tokens/types.
- Create `apps/api/src/observability/request-context.ts`: Express request extension carrying `requestId`.
- Create `apps/api/src/observability/request-id.ts`: pure header validation and selection helpers.
- Create `apps/api/src/observability/request-id.test.ts`: request-ID boundary and rejection tests.
- Create `apps/api/src/observability/request-id.middleware.ts`: attach/echo the final ID.
- Create `apps/api/src/observability/request-id.middleware.test.ts`: middleware side-effect tests.
- Create `apps/api/src/observability/route-resolver.ts`: route-template resolution and safe pathname fallback.
- Create `apps/api/src/observability/route-resolver.test.ts`: prefix/template/fallback tests.
- Create `apps/api/src/observability/http-logging.interceptor.ts`: one response-finish completion event.
- Create `apps/api/src/observability/http-logging.interceptor.test.ts`: fields, levels, suppression, and duplicate protection.
- Create `apps/api/src/observability/api-error-response.ts`: normalized public envelope and pure mapping helpers.
- Create `apps/api/src/observability/api-error-response.test.ts`: safe `4xx` and redacted `5xx` mapping.
- Create `apps/api/src/observability/api-exception.filter.ts`: error logging and response writing.
- Create `apps/api/src/observability/api-exception.filter.test.ts`: matching header/body IDs and safe event context.
- Create `apps/api/src/observability/observability.module.ts`: global logger, middleware, interceptor, and filter registration.

### Dependency clients and probes

- Create `apps/api/src/dependencies/tokens.ts`: client and probe tokens.
- Create `apps/api/src/dependencies/ports.ts`: minimal PostgreSQL/Redis interfaces used by probes and lifecycle tests.
- Create `apps/api/src/dependencies/dependency-clients.ts`: lazy client factory functions with bounded client timeouts.
- Create `apps/api/src/dependencies/dependency-clients.test.ts`: assert safe options and no eager-connect call.
- Create `apps/api/src/dependencies/dependency-lifecycle.service.ts`: idempotent shutdown of both clients.
- Create `apps/api/src/dependencies/dependency-lifecycle.service.test.ts`: close-once, fallback, and continue-after-error behavior.
- Create `apps/api/src/dependencies/readiness-probe.ts`: dependency names, public reason codes, and probe interface.
- Create `apps/api/src/dependencies/readiness-failure.ts`: safe error classification.
- Create `apps/api/src/dependencies/readiness-failure.test.ts`: network/authentication/unknown classification tests.
- Create `apps/api/src/dependencies/postgresql-readiness.probe.ts`: `SELECT 1` probe.
- Create `apps/api/src/dependencies/postgresql-readiness.probe.test.ts`: success, latency, failure, and unexpected-result tests.
- Create `apps/api/src/dependencies/redis-readiness.probe.ts`: `PING`/`PONG` probe.
- Create `apps/api/src/dependencies/redis-readiness.probe.test.ts`: success, latency, connection failure, and unexpected-reply tests.
- Create `apps/api/src/dependencies/dependencies.module.ts`: lazy singleton providers, lifecycle provider, and exported probe tokens.

### Health policy

- Create `apps/api/src/health/readiness-timeout.ts`: timeout wrapper that clears timers and consumes late settlements.
- Create `apps/api/src/health/readiness-timeout.test.ts`: resolve, reject, timeout, and late-rejection tests.
- Create `apps/api/src/health/health-response.factory.ts`: shared liveness/readiness metadata and uptime creation.
- Create `apps/api/src/health/health-response.factory.test.ts`: deterministic timestamp and uptime tests.
- Create `apps/api/src/health/readiness-coordinator.ts`: concurrent probes, timeout mapping, logging, cache, and in-flight deduplication.
- Create `apps/api/src/health/readiness-coordinator.test.ts`: status aggregation, timeout, cache, deduplication, and logging tests.
- Modify `apps/api/src/health/health.service.ts`: delegate response construction and readiness coordination.
- Modify `apps/api/src/health/health.service.test.ts`: liveness and coordinator-delegation tests.
- Modify `apps/api/src/health/health.controller.ts`: set readiness HTTP status without throwing.
- Modify `apps/api/src/health/health.module.ts`: import dependency providers and wire health services.
- Modify `apps/api/src/app.module.ts`: import observability and dependencies once.
- Modify `apps/api/src/main.ts`: keep global prefix/bootstrap behavior and rely on module-registered HTTP observability.

### Integration, docs, and delivery

- Modify `apps/api/test/health.e2e.test.ts`: deterministic probe overrides, request IDs, readiness status, normalized errors, and captured logs.
- Modify `README.md`: endpoint semantics, request ID, error envelope, events, timeout configuration, and smoke commands.
- Modify `docs/backlog/SPRINT-0.md`: mark the runtime-foundation item complete only after all checks pass.
- Temporarily create and later delete `.github/workflows/api-runtime-smoke.yml`: real PostgreSQL/Redis outage and recovery verification.

---

### Task 1: Pin dependencies and extend the environment boundary

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/config/environment.schema.ts`
- Modify: `apps/api/src/config/environment.schema.test.ts`
- Modify: `apps/api/src/config/environment.service.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: existing `parseEnvironment(source: unknown): Environment` and `EnvironmentService`.
- Produces: `Environment["readinessTimeoutMs"]: number` and `EnvironmentService.readinessTimeoutMs: number` for client factories and the readiness coordinator.

- [ ] **Step 1: Add failing environment tests**

Extend `validEnvironment` with `READINESS_TIMEOUT_MS: "900"` and assert the transformed object contains `readinessTimeoutMs: 900`. Add explicit tests:

```ts
test("parseEnvironment defaults READINESS_TIMEOUT_MS to 750", () => {
  const environment = parseEnvironment({
    DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking_os",
    REDIS_URL: "redis://localhost:6379/0",
  });

  assert.equal(environment.readinessTimeoutMs, 750);
});

test("parseEnvironment accepts readiness timeout boundaries", () => {
  assert.equal(
    parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: "100" }).readinessTimeoutMs,
    100,
  );
  assert.equal(
    parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: "5000" }).readinessTimeoutMs,
    5000,
  );
});

test("parseEnvironment rejects invalid readiness timeouts", () => {
  for (const value of ["99", "5001", "750.5", "not-a-number"]) {
    assert.throws(
      () => parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: value }),
      EnvironmentValidationError,
    );
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- src/config/environment.schema.test.ts
```

Expected: FAIL because `readinessTimeoutMs` is absent and invalid values are not rejected.

- [ ] **Step 3: Add exact package dependencies**

Run:

```bash
pnpm --filter @booking-os/api add pg@8.22.0 ioredis@5.11.1
pnpm --filter @booking-os/api add -D @types/express@5.0.6 @types/pg@8.20.0
```

Confirm `apps/api/package.json` contains exact versions and `pnpm-lock.yaml` changes only as required by those additions.

- [ ] **Step 4: Implement the environment field and getter**

Add to the Zod object before `.transform(...)`:

```ts
READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(5000).default(750),
```

Add to the transformed object:

```ts
readinessTimeoutMs: values.READINESS_TIMEOUT_MS,
```

Add to `EnvironmentService`:

```ts
get readinessTimeoutMs(): number {
  return this.values.readinessTimeoutMs;
}
```

Add to `apps/api/.env.example`:

```dotenv
READINESS_TIMEOUT_MS=750
```

- [ ] **Step 5: Run configuration, type, and frozen-install checks**

Run:

```bash
pnpm --filter @booking-os/api test -- src/config/environment.schema.test.ts
pnpm --filter @booking-os/api typecheck
pnpm install --frozen-lockfile
```

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/config apps/api/.env.example
git commit -m "feat(api): add readiness timeout configuration"
```

---

### Task 2: Add the global logger and request-ID propagation

**Files:**
- Create: `apps/api/src/observability/tokens.ts`
- Create: `apps/api/src/observability/request-context.ts`
- Create: `apps/api/src/observability/request-id.ts`
- Create: `apps/api/src/observability/request-id.test.ts`
- Create: `apps/api/src/observability/request-id.middleware.ts`
- Create: `apps/api/src/observability/request-id.middleware.test.ts`
- Create: `apps/api/src/observability/observability.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `createStructuredLogger({ service: "api" })` from `@booking-os/observability`.
- Produces: `API_LOGGER_TOKEN`, `REQUEST_ID_GENERATOR_TOKEN`, `MONOTONIC_CLOCK_TOKEN`, `RequestWithContext`, `selectRequestId(...)`, and middleware applied to `"{*splat}"`.

- [ ] **Step 1: Write failing pure request-ID tests**

Define expected signatures in the tests:

```ts
import { isValidRequestId, selectRequestId } from "./request-id.js";

assert.equal(isValidRequestId("gateway.id_1:part-2"), true);
assert.equal(isValidRequestId("a".repeat(128)), true);
assert.equal(isValidRequestId(""), false);
assert.equal(isValidRequestId("a".repeat(129)), false);
assert.equal(isValidRequestId("has space"), false);
assert.equal(isValidRequestId("line\nbreak"), false);
assert.equal(isValidRequestId("unicode-đ"), false);
assert.equal(selectRequestId("valid-id", () => "generated-id"), "valid-id");
assert.equal(selectRequestId(undefined, () => "generated-id"), "generated-id");
assert.equal(selectRequestId(["bad value", "valid-id"], () => "generated-id"), "generated-id");
```

Also assert the generator is not called when the upstream value is accepted.

- [ ] **Step 2: Run request-ID tests and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- src/observability/request-id.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement tokens, request type, and pure selection**

Create `tokens.ts`:

```ts
import type { StructuredLogger } from "@booking-os/observability";

export const API_LOGGER_TOKEN = Symbol("API_LOGGER");
export const REQUEST_ID_GENERATOR_TOKEN = Symbol("REQUEST_ID_GENERATOR");
export const MONOTONIC_CLOCK_TOKEN = Symbol("MONOTONIC_CLOCK");

export type ApiLogger = StructuredLogger;
export type RequestIdGenerator = () => string;
export type MonotonicClock = () => number;
```

Create `request-context.ts`:

```ts
import type { Request } from "express";

export interface RequestWithContext extends Request {
  requestId: string;
}
```

Create `request-id.ts`:

```ts
import type { IncomingHttpHeaders } from "node:http";
import type { RequestIdGenerator } from "./tokens.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function selectRequestId(
  header: IncomingHttpHeaders["x-request-id"],
  generate: RequestIdGenerator,
): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return isValidRequestId(candidate) ? candidate : generate();
}
```

- [ ] **Step 4: Write failing middleware side-effect tests**

Use minimal request/response doubles and assert:

```ts
const request = { headers: { "x-request-id": "upstream-1" } } as RequestWithContext;
const headers = new Map<string, string>();
const response = {
  setHeader(name: string, value: string) {
    headers.set(name.toLowerCase(), value);
  },
} as Response;
let nextCalls = 0;

new RequestIdMiddleware(() => "generated-1").use(request, response, () => {
  nextCalls += 1;
});

assert.equal(request.requestId, "upstream-1");
assert.equal(headers.get("x-request-id"), "upstream-1");
assert.equal(nextCalls, 1);
```

Add a rejected-header case that expects `generated-1` in both locations and never echoes the rejected input.

- [ ] **Step 5: Implement middleware and module registration**

Implement the middleware:

```ts
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(
    @Inject(REQUEST_ID_GENERATOR_TOKEN)
    private readonly generateRequestId: RequestIdGenerator,
  ) {}

  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const requestId = selectRequestId(request.headers["x-request-id"], this.generateRequestId);
    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }
}
```

Create a global module with dependency-injectable defaults:

```ts
@Global()
@Module({
  providers: [
    {
      provide: API_LOGGER_TOKEN,
      useFactory: (): StructuredLogger => createStructuredLogger({ service: "api" }),
    },
    { provide: REQUEST_ID_GENERATOR_TOKEN, useValue: randomUUID },
    { provide: MONOTONIC_CLOCK_TOKEN, useValue: () => performance.now() },
    RequestIdMiddleware,
  ],
  exports: [API_LOGGER_TOKEN, MONOTONIC_CLOCK_TOKEN],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*splat}");
  }
}
```

Import `ObservabilityModule` once from `AppModule`.

- [ ] **Step 6: Run focused tests and API typecheck**

Run:

```bash
pnpm --filter @booking-os/api test -- src/observability/request-id.test.ts src/observability/request-id.middleware.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/observability apps/api/src/app.module.ts
git commit -m "feat(api): propagate safe request IDs"
```

---

### Task 3: Emit one structured HTTP completion event

**Files:**
- Create: `apps/api/src/observability/route-resolver.ts`
- Create: `apps/api/src/observability/route-resolver.test.ts`
- Create: `apps/api/src/observability/http-logging.interceptor.ts`
- Create: `apps/api/src/observability/http-logging.interceptor.test.ts`
- Modify: `apps/api/src/observability/observability.module.ts`

**Interfaces:**
- Consumes: `RequestWithContext`, `API_LOGGER_TOKEN`, `MONOTONIC_CLOCK_TOKEN`, and `EnvironmentService.apiPrefix`.
- Produces: `resolveRequestRoute(request): string`, `isSuccessfulHealthRoute(route, statusCode, apiPrefix): boolean`, and global `HttpLoggingInterceptor` registration via `APP_INTERCEPTOR`.

- [ ] **Step 1: Write failing route-resolution tests**

Cover these exact cases:

```ts
assert.equal(
  resolveRequestRoute({ baseUrl: "/api", route: { path: "/bookings/:id" } } as Request),
  "/api/bookings/:id",
);
assert.equal(
  resolveRequestRoute({ baseUrl: "", route: { path: "/api/health" } } as Request),
  "/api/health",
);
assert.equal(
  resolveRequestRoute({ originalUrl: "/api/search?q=secret" } as Request),
  "/api/search",
);
assert.equal(isSuccessfulHealthRoute("/api/health", 200, "api"), true);
assert.equal(isSuccessfulHealthRoute("/api/ready", 200, "api"), true);
assert.equal(isSuccessfulHealthRoute("/api/ready", 503, "api"), false);
assert.equal(isSuccessfulHealthRoute("/api/health/extra", 200, "api"), false);
```

- [ ] **Step 2: Run route tests and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- src/observability/route-resolver.test.ts
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement safe route resolution**

Use the resolved route template when available and otherwise strip the query with `new URL(originalUrl, "http://localhost").pathname`. Normalize duplicate slashes and ensure the result starts with `/`. Build health paths from `apiPrefix` rather than hard-coding `api`.

- [ ] **Step 4: Write failing interceptor tests**

Create a response double backed by `EventEmitter`; call the interceptor, set `statusCode`, emit `finish` twice, and assert exactly one record. Required assertions:

```ts
assert.equal(record.message, "http.request_completed");
assert.equal(record.requestId, "request-1");
assert.equal(record.method, "GET");
assert.equal(record.route, "/api/bookings/:id");
assert.equal(record.statusCode, 200);
assert.equal(record.durationMs, 12);
assert.equal(record.level, "info");
```

Add cases for:

- status `500` uses `warn`;
- `/api/health` `200` emits no record;
- `/api/ready` `200` emits no record;
- `/api/ready` `503` emits one record;
- fallback route excludes `?token=secret`;
- repeated defensive completion calls do not duplicate the event.

- [ ] **Step 5: Implement the interceptor**

The interceptor must register `response.once("finish", ...)` before returning `next.handle()`. Use a local `logged` guard, the injected monotonic clock, and the final response status:

```ts
const startedAt = this.now();
let logged = false;

response.once("finish", () => {
  if (logged) return;
  logged = true;

  const route = resolveRequestRoute(request);
  if (isSuccessfulHealthRoute(route, response.statusCode, this.environment.apiPrefix)) return;

  const context = {
    requestId: request.requestId,
    method: request.method,
    route,
    statusCode: response.statusCode,
    durationMs: Math.max(0, Math.round((this.now() - startedAt) * 1000) / 1000),
  };

  const logger = this.logger.child({ requestId: request.requestId });
  if (response.statusCode >= 500) logger.warn("http.request_completed", context);
  else logger.info("http.request_completed", context);
});
```

Register globally:

```ts
{
  provide: APP_INTERCEPTOR,
  useClass: HttpLoggingInterceptor,
}
```

- [ ] **Step 6: Run observability tests**

Run:

```bash
pnpm --filter @booking-os/api test -- src/observability/route-resolver.test.ts src/observability/http-logging.interceptor.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/observability
git commit -m "feat(api): add structured HTTP completion logs"
```

---

### Task 4: Normalize API errors and emit failure events

**Files:**
- Create: `apps/api/src/observability/api-error-response.ts`
- Create: `apps/api/src/observability/api-error-response.test.ts`
- Create: `apps/api/src/observability/api-exception.filter.ts`
- Create: `apps/api/src/observability/api-exception.filter.test.ts`
- Modify: `apps/api/src/observability/observability.module.ts`

**Interfaces:**
- Consumes: `RequestWithContext`, `resolveRequestRoute`, and `API_LOGGER_TOKEN`.
- Produces: `ApiErrorResponse`, `normalizeApiError(exception): { statusCode; body }`, and global `ApiExceptionFilter` registration via `APP_FILTER`.

- [ ] **Step 1: Write failing pure normalization tests**

Cover exact output for:

```ts
assert.deepEqual(
  normalizeApiError(new BadRequestException("Invalid input"), "request-1"),
  {
    statusCode: 400,
    body: {
      statusCode: 400,
      error: "Bad Request",
      message: "Invalid input",
      requestId: "request-1",
    },
  },
);
```

Also cover an object-form validation exception with `message: ["name must not be empty"]`, an extra unsafe field such as `debug: "secret"` that must be omitted, a `ServiceUnavailableException("database URL ...")` that must become the fixed public `503` message, and an unknown `Error("password=secret")` that must become:

```ts
{
  statusCode: 500,
  body: {
    statusCode: 500,
    error: "Internal Server Error",
    message: "An unexpected error occurred",
    requestId: "request-1",
  },
}
```

- [ ] **Step 2: Run normalization tests and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- src/observability/api-error-response.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure mapper**

Use `HttpException.getStatus()`, `HttpException.getResponse()`, and `STATUS_CODES`. Accept only a string or an array containing only strings for the public message. Accept only a string `error` field. For every status `>= 500`, ignore the exception payload and use the fixed public message.

- [ ] **Step 4: Write failing exception-filter tests**

Create request/response/`ArgumentsHost` doubles and a captured structured logger. Assert:

- the response status is set once;
- body `requestId` equals the existing `x-request-id` header;
- `http.request_failed` is emitted exactly once at `error` level;
- event context includes only `requestId`, `method`, `route`, and `statusCode` plus the logger's serialized error;
- request body, query object, cookie, authorization header, and environment-like values never appear in the serialized record.

- [ ] **Step 5: Implement and register the filter**

The filter should follow this shape:

```ts
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const normalized = normalizeApiError(exception, request.requestId);
    const route = resolveRequestRoute(request);

    this.logger.child({ requestId: request.requestId }).error(
      "http.request_failed",
      exception,
      {
        method: request.method,
        route,
        statusCode: normalized.statusCode,
      },
    );

    response.status(normalized.statusCode).json(normalized.body);
  }
}
```

Register globally:

```ts
{
  provide: APP_FILTER,
  useClass: ApiExceptionFilter,
}
```

- [ ] **Step 6: Run all HTTP observability tests**

Run:

```bash
pnpm --filter @booking-os/api test -- src/observability
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/observability
git commit -m "feat(api): normalize and log HTTP failures"
```

---

### Task 5: Create lazy dependency clients and safe shutdown

**Files:**
- Create: `apps/api/src/dependencies/tokens.ts`
- Create: `apps/api/src/dependencies/ports.ts`
- Create: `apps/api/src/dependencies/dependency-clients.ts`
- Create: `apps/api/src/dependencies/dependency-clients.test.ts`
- Create: `apps/api/src/dependencies/dependency-lifecycle.service.ts`
- Create: `apps/api/src/dependencies/dependency-lifecycle.service.test.ts`
- Create: `apps/api/src/dependencies/dependencies.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `EnvironmentService.databaseUrl`, `redisUrl`, `readinessTimeoutMs`, `API_LOGGER_TOKEN`.
- Produces: `POSTGRES_POOL_TOKEN`, `REDIS_CLIENT_TOKEN`, `PostgresPoolPort`, `RedisClientPort`, lazy factory functions, and idempotent lifecycle cleanup.

- [ ] **Step 1: Write failing client-factory tests**

Define injectable constructor doubles and assert the factories pass these options without invoking `connect`, `query`, or `ping`:

```ts
assert.deepEqual(postgresOptions, {
  connectionString: "postgresql://user:password@localhost:5432/db",
  connectionTimeoutMillis: 750,
  query_timeout: 750,
});

assert.equal(redisUrl, "redis://localhost:6379/0");
assert.equal(redisOptions.lazyConnect, true);
assert.equal(redisOptions.connectTimeout, 750);
assert.equal(redisOptions.commandTimeout, 750);
assert.equal(redisOptions.maxRetriesPerRequest, 1);
```

Assert the Redis factory registers an `error` listener but does not call `connect()`.

- [ ] **Step 2: Run factory tests and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- src/dependencies/dependency-clients.test.ts
```

Expected: FAIL because the factories do not exist.

- [ ] **Step 3: Implement minimal ports, tokens, and lazy factories**

Define only the operations this scope needs:

```ts
export interface PostgresPoolPort {
  query<T extends Record<string, unknown>>(text: string): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

export interface RedisClientPort {
  readonly status: string;
  ping(): Promise<string>;
  quit(): Promise<string>;
  disconnect(reconnect?: boolean): void;
  on(event: "error", listener: (error: unknown) => void): this;
}
```

Create `pg.Pool` without querying. Create `Redis` with `lazyConnect: true`, bounded connect/command timeouts, one retry per request, and its normal reconnect strategy. Register a non-throwing `error` listener that does not log the raw error or URL.

- [ ] **Step 4: Write failing lifecycle tests**

Use doubles to prove:

- two calls to `close()` call `pool.end()` once and `redis.quit()` once;
- a rejected `redis.quit()` calls `redis.disconnect(false)`;
- a rejected `pool.end()` does not prevent Redis cleanup;
- cleanup failures emit `dependency.shutdown_failed` with only `dependency` in event context;
- `onApplicationShutdown()` delegates to `close()`.

- [ ] **Step 5: Implement idempotent lifecycle cleanup**

Use one stored promise rather than a boolean so concurrent callers share cleanup:

```ts
private closePromise?: Promise<void>;

close(): Promise<void> {
  this.closePromise ??= this.closeResources();
  return this.closePromise;
}
```

Attempt PostgreSQL and Redis cleanup independently. Log a safe event for each failed cleanup and do not rethrow configuration details.

- [ ] **Step 6: Wire the initial `DependenciesModule`**

Provide lazy clients with factory providers and register `DependencyLifecycleService`. Import `ObservabilityModule` for the logger token and export the two client tokens only inside this module for the next task; do not expose them from the application module.

Import `DependenciesModule` once in `AppModule`.

- [ ] **Step 7: Run focused tests and prove unreachable targets do not break module construction**

Run:

```bash
pnpm --filter @booking-os/api test -- src/dependencies/dependency-clients.test.ts src/dependencies/dependency-lifecycle.service.test.ts
DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/invalid REDIS_URL=redis://127.0.0.1:1 READINESS_TIMEOUT_MS=100 pnpm --filter @booking-os/api test -- test/health.e2e.test.ts
pnpm --filter @booking-os/api typecheck
```

At this stage the existing readiness e2e may still assert the old empty map, but application construction and `/api/health` must not fail because no client connects during bootstrap.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/dependencies apps/api/src/app.module.ts
git commit -m "feat(api): add lazy dependency clients"
```

---

### Task 6: Implement isolated PostgreSQL and Redis readiness probes

**Files:**
- Create: `apps/api/src/dependencies/readiness-probe.ts`
- Create: `apps/api/src/dependencies/readiness-failure.ts`
- Create: `apps/api/src/dependencies/readiness-failure.test.ts`
- Create: `apps/api/src/dependencies/postgresql-readiness.probe.ts`
- Create: `apps/api/src/dependencies/postgresql-readiness.probe.test.ts`
- Create: `apps/api/src/dependencies/redis-readiness.probe.ts`
- Create: `apps/api/src/dependencies/redis-readiness.probe.test.ts`
- Modify: `apps/api/src/dependencies/tokens.ts`
- Modify: `apps/api/src/dependencies/dependencies.module.ts`

**Interfaces:**
- Consumes: `PostgresPoolPort`, `RedisClientPort`, and `MONOTONIC_CLOCK_TOKEN`.
- Produces: `ReadinessProbe`, `ReadinessDependency`, `ReadinessFailureReason`, `POSTGRES_READINESS_PROBE_TOKEN`, and `REDIS_READINESS_PROBE_TOKEN` exported by `DependenciesModule`.

- [ ] **Step 1: Write failing failure-classification tests**

Use errors with these safe codes and expectations:

```ts
for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "28P01", "08006"]) {
  const error = Object.assign(new Error("internal detail"), { code });
  assert.equal(classifyReadinessError(error), "connection_failed");
}

assert.equal(classifyReadinessError(new Error("WRONGPASS invalid username-password pair")), "connection_failed");
assert.equal(classifyReadinessError(new Error("NOAUTH Authentication required")), "connection_failed");
assert.equal(classifyReadinessError(new Error("unexpected parser failure")), "unexpected_response");
assert.equal(classifyReadinessError("not-an-error"), "unexpected_response");
```

The classifier may inspect messages internally for the fixed Redis authentication prefixes, but callers must never return or log those messages.

- [ ] **Step 2: Run classifier tests and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- src/dependencies/readiness-failure.test.ts
```

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Define probe contracts and classifier**

Create:

```ts
export type ReadinessDependency = "postgresql" | "redis";
export type ReadinessFailureReason = "timeout" | "connection_failed" | "unexpected_response";

export interface ReadinessProbe {
  readonly dependency: ReadinessDependency;
  check(): Promise<HealthDependencyStatus>;
}
```

Classify Node/socket codes, PostgreSQL SQLSTATE classes `08` and `28`, and fixed Redis authentication prefixes. Return only one of the two non-timeout reasons; timeout belongs to the coordinator.

- [ ] **Step 4: Write failing PostgreSQL probe tests**

Use a fake clock sequence such as `[10, 14.25]`. Assert:

- the probe calls exactly `query("SELECT 1 AS ready")`;
- `{ rows: [{ ready: 1 }] }` returns `{ status: "ok", latencyMs: 4.25 }`;
- a connection-coded rejection returns `{ status: "unavailable", latencyMs: 4.25, message: "connection_failed" }`;
- an empty row set or `ready !== 1` returns `unexpected_response`;
- raw exception text is absent from the result.

- [ ] **Step 5: Implement the PostgreSQL probe**

Catch client errors and map them with `classifyReadinessError`. Validate the expected row shape instead of treating any fulfilled query as healthy. Round latency to at most three decimal places.

- [ ] **Step 6: Write failing Redis probe tests**

Assert:

- exact `"PONG"` returns `ok`;
- `"pong"`, `"OK"`, and an empty reply return `unexpected_response`;
- connection-coded rejection returns `connection_failed`;
- latency uses the injected monotonic clock;
- the returned body never contains the original exception message.

- [ ] **Step 7: Implement the Redis probe and wire providers**

Call `ping()` once per `check()`. Register both probes under distinct tokens:

```ts
{
  provide: POSTGRES_READINESS_PROBE_TOKEN,
  inject: [POSTGRES_POOL_TOKEN, MONOTONIC_CLOCK_TOKEN],
  useFactory: (pool, now) => new PostgreSQLReadinessProbe(pool, now),
},
{
  provide: REDIS_READINESS_PROBE_TOKEN,
  inject: [REDIS_CLIENT_TOKEN, MONOTONIC_CLOCK_TOKEN],
  useFactory: (client, now) => new RedisReadinessProbe(client, now),
},
```

Export only the two probe tokens from `DependenciesModule`; keep raw clients module-internal.

- [ ] **Step 8: Run dependency tests**

Run:

```bash
pnpm --filter @booking-os/api test -- src/dependencies
pnpm --filter @booking-os/api typecheck
```

Expected: PASS with no real network connection.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/dependencies
git commit -m "feat(api): add dependency readiness probes"
```

---

### Task 7: Add bounded timeout, health response factory, cache, and in-flight deduplication

**Files:**
- Create: `apps/api/src/health/readiness-timeout.ts`
- Create: `apps/api/src/health/readiness-timeout.test.ts`
- Create: `apps/api/src/health/health-response.factory.ts`
- Create: `apps/api/src/health/health-response.factory.test.ts`
- Create: `apps/api/src/health/readiness-coordinator.ts`
- Create: `apps/api/src/health/readiness-coordinator.test.ts`

**Interfaces:**
- Consumes: both `ReadinessProbe` providers, `EnvironmentService`, `API_LOGGER_TOKEN`, and `MONOTONIC_CLOCK_TOKEN`.
- Produces: `withReadinessTimeout`, `HealthResponseFactory`, `ReadinessCoordinator.getReadiness(requestId?: string): Promise<ReadinessResult>`, and `ReadinessResult = { statusCode: 200 | 503; body: HealthResponse }`.

- [ ] **Step 1: Write failing timeout tests**

Cover:

```ts
assert.equal(await withReadinessTimeout(Promise.resolve("ok"), 100), "ok");
await assert.rejects(
  withReadinessTimeout(Promise.reject(new Error("boom")), 100),
  /boom/,
);
await assert.rejects(
  withReadinessTimeout(new Promise(() => undefined), 5),
  ReadinessTimeoutError,
);
```

Add a late rejection after the timeout and attach a temporary `process.on("unhandledRejection")` listener; assert the listener receives nothing. Use `test.after()` cleanup so listeners are always removed.

- [ ] **Step 2: Run timeout tests and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- src/health/readiness-timeout.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the timeout helper**

Use one `setTimeout`, clear it on every settlement, and attach both fulfillment and rejection handlers to the underlying operation so late settlement is consumed. Reject with a dedicated `ReadinessTimeoutError` containing no URL or client detail.

- [ ] **Step 4: Write failing response-factory tests**

Inject a wall clock and monotonic clock. Assert deterministic output:

```ts
assert.deepEqual(factory.create("ok"), {
  service: "api",
  status: "ok",
  version: "0.1.0-test",
  timestamp: "2026-08-04T02:00:00.000Z",
  uptimeSeconds: 12,
});
```

Also assert dependency maps are copied into readiness responses and uptime never goes below zero.

- [ ] **Step 5: Implement `HealthResponseFactory`**

Capture monotonic start time in the constructor. Use an injected `() => Date` wall clock for ISO timestamps and the shared monotonic clock for uptime. Do not read process environment directly.

- [ ] **Step 6: Write failing coordinator tests**

Create probe doubles with call counters and controllable promises. Required cases:

1. Both `ok` results run concurrently and produce HTTP `200`.
2. One unavailable result preserves the other successful result and produces HTTP `503`.
3. Both unavailable results produce HTTP `503`.
4. A never-resolving probe becomes `{ status: "unavailable", message: "timeout" }` after the configured deadline.
5. The two probes each receive an independent timeout; endpoint duration is near the slower deadline, not the sum.
6. A successful result is returned from cache within `1000ms` without new calls.
7. An unavailable result is also cached.
8. Advancing the fake monotonic clock beyond expiry triggers a new pair of calls.
9. Two simultaneous callers receive the same in-flight promise and cause only one call per probe.
10. A later call can run after an unexpected coordinator rejection, proving `inFlight` clears in `finally`.
11. `readiness.probe_failed` is emitted once per actual unavailable probe run with `requestId`, `dependency`, `durationMs`, and `reason`.
12. Cache hits emit no additional probe-failure event.

- [ ] **Step 7: Implement the coordinator**

Use this public shape:

```ts
export interface ReadinessResult {
  readonly statusCode: 200 | 503;
  readonly body: HealthResponse;
}
```

Core algorithm:

```ts
async getReadiness(requestId?: string): Promise<ReadinessResult> {
  const now = this.now();
  if (this.cachedResult && this.cachedResult.expiresAt > now) {
    return this.cachedResult.result;
  }
  if (this.inFlight) return this.inFlight;

  this.inFlight = this.runProbes(requestId)
    .then((result) => {
      this.cachedResult = { expiresAt: this.now() + 1000, result };
      return result;
    })
    .finally(() => {
      this.inFlight = undefined;
    });

  return this.inFlight;
}
```

In `runProbes`, start both wrapped checks before awaiting `Promise.all`. Convert only `ReadinessTimeoutError` to `timeout`; probe implementation rejections that escape their own classifier remain unexpected implementation errors and propagate to the global filter. Log unavailable statuses after the actual run, never on cache hits.

- [ ] **Step 8: Run health policy tests**

Run:

```bash
pnpm --filter @booking-os/api test -- src/health/readiness-timeout.test.ts src/health/health-response.factory.test.ts src/health/readiness-coordinator.test.ts
pnpm --filter @booking-os/api typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/health
git commit -m "feat(api): coordinate cached readiness checks"
```

---

### Task 8: Integrate readiness policy into the health HTTP endpoints

**Files:**
- Modify: `apps/api/src/health/health.service.ts`
- Modify: `apps/api/src/health/health.service.test.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- Consumes: `HealthResponseFactory` and `ReadinessCoordinator`.
- Produces: synchronous `HealthService.getHealth(): HealthResponse`, asynchronous `HealthService.getReadiness(requestId?: string): Promise<ReadinessResult>`, and controller-level HTTP `200`/`503` status selection without throwing.

- [ ] **Step 1: Replace the old readiness unit test with failing delegation tests**

Use doubles and assert:

```ts
const expected = {
  statusCode: 503 as const,
  body: buildHealthResponse({ status: "unavailable" }),
};

assert.equal(service.getHealth(), livenessResponse);
assert.equal(await service.getReadiness("request-1"), expected);
assert.deepEqual(coordinatorRequestIds, ["request-1"]);
```

The liveness test must prove no probe or coordinator call occurs.

- [ ] **Step 2: Run the health service test and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test -- src/health/health.service.test.ts
```

Expected: FAIL because the service still returns an empty dependency map synchronously.

- [ ] **Step 3: Implement service and controller integration**

`HealthService` delegates liveness body creation to `HealthResponseFactory` and readiness to `ReadinessCoordinator`.

Use passthrough response handling so the existing health body is returned directly:

```ts
@Get("ready")
async getReadiness(
  @Req() request: RequestWithContext,
  @Res({ passthrough: true }) response: Response,
): Promise<HealthResponse> {
  const result = await this.healthService.getReadiness(request.requestId);
  response.status(result.statusCode);
  return result.body;
}
```

Do not throw `ServiceUnavailableException`, because that would replace the health body with the global error envelope.

- [ ] **Step 4: Wire the module providers**

`HealthModule` imports `DependenciesModule`, provides `HealthResponseFactory`, `ReadinessCoordinator`, and `HealthService`, and injects the two probe tokens into the coordinator. `AppModule` imports modules in this order:

```ts
imports: [EnvironmentModule, ObservabilityModule, DependenciesModule, HealthModule]
```

Keep `main.ts` responsible only for dotenv loading, Nest creation, shutdown hooks, global prefix, listen, and service bootstrap events. Do not manually register middleware, interceptor, or filter there.

- [ ] **Step 5: Run API unit, type, and build checks**

Run:

```bash
pnpm --filter @booking-os/api test -- src
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/api build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/health apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat(api): expose real readiness status"
```

---

### Task 9: Add deterministic API e2e coverage and enforce it in `pnpm test`

**Files:**
- Modify: `apps/api/test/health.e2e.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `POSTGRES_READINESS_PROBE_TOKEN`, `REDIS_READINESS_PROBE_TOKEN`, `API_LOGGER_TOKEN`, and `REQUEST_ID_GENERATOR_TOKEN`.
- Produces: deterministic full-HTTP coverage without Docker and a standard API `test` script that runs both `src/**/*.test.ts` and `test/**/*.test.ts`.

- [ ] **Step 1: Rewrite e2e setup with injectable doubles**

Create mutable probe doubles and a captured logger sink:

```ts
const records: StructuredLogRecord[] = [];
const postgresProbe = { dependency: "postgresql" as const, check: async () => postgresStatus };
const redisProbe = { dependency: "redis" as const, check: async () => redisStatus };

const testingModule = await Test.createTestingModule({
  imports: [AppModule],
  controllers: [TestErrorController],
})
  .overrideProvider(POSTGRES_READINESS_PROBE_TOKEN)
  .useValue(postgresProbe)
  .overrideProvider(REDIS_READINESS_PROBE_TOKEN)
  .useValue(redisProbe)
  .overrideProvider(API_LOGGER_TOKEN)
  .useValue(createStructuredLogger({ service: "api", sink: (record) => records.push(record) }))
  .overrideProvider(REQUEST_ID_GENERATOR_TOKEN)
  .useValue(() => "generated-request-id")
  .compile();
```

Add a test-only controller that throws `new Error("internal database detail")` at `GET /api/test/boom`.

- [ ] **Step 2: Add failing e2e cases**

Required requests and assertions:

- `GET /api/health` returns `200`, liveness body, and a generated `x-request-id`.
- valid upstream `x-request-id: upstream-1` returns unchanged.
- invalid upstream `x-request-id: bad value` is replaced by `generated-request-id`.
- both probes `ok` make `/api/ready` return `200` with both dependency statuses.
- Redis unavailable makes `/api/ready` return `503`, keeps PostgreSQL `ok`, and returns only safe reason codes.
- `/api/test/boom` returns the fixed `500` envelope; body and header IDs match; internal text is absent.
- successful health/readiness requests produce no `http.request_completed` record.
- readiness `503` produces `readiness.probe_failed` and `http.request_completed` with status `503`.
- error route produces one `http.request_failed` and one `http.request_completed`.

Reset coordinator cache and captured records between tests by rebuilding the Nest app per test group or by using a test-only coordinator factory with a fresh instance; do not let the one-second cache make tests order-dependent.

- [ ] **Step 3: Run e2e tests and verify RED**

Run:

```bash
pnpm --filter @booking-os/api test:e2e
```

Expected: at least the new readiness, request-ID, error-envelope, or log assertions FAIL until wiring is complete.

- [ ] **Step 4: Fix only integration defects exposed by e2e**

Keep fixes inside the module boundaries already defined. Do not add test-only behavior to production controllers and do not weaken public redaction or cache semantics.

- [ ] **Step 5: Make the standard API test command enforce e2e**

Change:

```json
"test": "node --test --import tsx \"src/**/*.test.ts\" \"test/**/*.test.ts\""
```

Keep `test:e2e` as the focused e2e command.

- [ ] **Step 6: Run the complete API suite twice**

Run:

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/api build
```

Expected: both test runs PASS with no order-dependent cache or global-listener failure.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/health.e2e.test.ts apps/api/package.json
git commit -m "test(api): cover request observability and readiness"
```

---

### Task 10: Document the delivered runtime contract

**Files:**
- Modify: `README.md`
- Modify: `apps/api/.env.example` if formatting or placement needs adjustment after implementation.

**Interfaces:**
- Consumes: final endpoint, error, event, and environment behavior.
- Produces: operator/developer documentation that matches the implemented public contract.

- [ ] **Step 1: Update local endpoint documentation**

Document:

```text
GET http://localhost:3001/api/health  -> process liveness, HTTP 200 while serving
GET http://localhost:3001/api/ready   -> PostgreSQL + Redis readiness, HTTP 200 or 503
```

State that readiness executes `SELECT 1` and `PING`, caches results for one second, and requires both dependencies.

- [ ] **Step 2: Document request ID and public error shape**

Include the accepted pattern and representative envelope:

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "requestId": "43c2387d-98c8-4e73-9f67-a32f36c945df"
}
```

Explain that `x-request-id` is preserved only when safe, is always returned, and is a correlation value rather than an authentication guarantee.

- [ ] **Step 3: Document structured events and prohibited fields**

List:

```text
http.request_completed
http.request_failed
readiness.probe_failed
dependency.shutdown_failed
```

Document the safe context fields and explicitly state that bodies, raw query values, cookies, authorization, credentials, and connection URLs are never logged.

- [ ] **Step 4: Document environment and local smoke commands**

Add:

```dotenv
READINESS_TIMEOUT_MS=750
```

Add commands for starting PostgreSQL/Redis only and running the API:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d postgres redis
cp apps/api/.env.example apps/api/.env
pnpm --filter @booking-os/api dev
curl -i http://localhost:3001/api/health
curl -i http://localhost:3001/api/ready
```

Mention that the copied `.env` is local-only and must not be committed.

- [ ] **Step 5: Run documentation and knowledge checks**

Run:

```bash
pnpm check:ci
python tools/genesis_cli.py validate
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md apps/api/.env.example
git commit -m "docs: describe API readiness and request observability"
```

---

### Task 11: Run real dependency smoke, full verification, CI, and close the backlog item

**Files:**
- Temporarily create: `.github/workflows/api-runtime-smoke.yml`
- Delete before final tree: `.github/workflows/api-runtime-smoke.yml`
- Modify after all checks pass: `docs/backlog/SPRINT-0.md`

**Interfaces:**
- Consumes: the complete feature branch.
- Produces: recorded real-infrastructure evidence, a clean final tree, green unified CI, and the completed Sprint 0 checkbox.

- [ ] **Step 1: Run clean local-equivalent verification**

Run from a clean checkout/worktree:

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

Expected: every command PASS. Fix failures at their source; do not relax tests, lint rules, dependency-audit level, or secret scanning.

- [ ] **Step 2: Create a temporary runtime-smoke workflow**

Create `.github/workflows/api-runtime-smoke.yml` with a manually dispatchable and branch-push job that:

1. checks out the repository;
2. sets up pnpm `10.34.5` and Node `22`;
3. installs with `--frozen-lockfile`;
4. copies `.env.docker.example` to `.env.docker`;
5. starts only `postgres` and `redis` with Docker Compose;
6. waits for `pg_isready` and `redis-cli ping`;
7. builds and starts the API with `READINESS_TIMEOUT_MS=500`, redirecting stdout/stderr to `api.log`;
8. performs the assertions below;
9. always uploads `api.log` on failure for diagnosis;
10. always shuts down the API and Compose services.

Use this shell sequence inside the verification step:

```bash
set -euo pipefail

export NODE_ENV=test
export HOST=127.0.0.1
export PORT=3001
export API_PREFIX=api
export APP_VERSION=runtime-smoke
export LOG_LEVEL=debug
export DATABASE_URL=postgresql://booking:booking@localhost:5432/booking_os
export REDIS_URL=redis://localhost:6379/0
export READINESS_TIMEOUT_MS=500

node apps/api/dist/main.js > api.log 2>&1 &
API_PID=$!

cleanup() {
  kill -TERM "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  docker compose --env-file .env.docker down --volumes --remove-orphans
}
trap cleanup EXIT

timeout 60 bash -c 'until curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null; do sleep 1; done'

curl --fail --silent \
  -H 'x-request-id: health-silent' \
  -D health.headers \
  http://127.0.0.1:3001/api/health > health.json
grep -qi '^x-request-id: health-silent' health.headers
jq -e '.status == "ok"' health.json

curl --fail --silent \
  -H 'x-request-id: ready-healthy' \
  http://127.0.0.1:3001/api/ready > ready.json
jq -e '.status == "ok" and .dependencies.postgresql.status == "ok" and .dependencies.redis.status == "ok"' ready.json

docker compose --env-file .env.docker stop redis
sleep 2
READY_STATUS=$(curl --silent --output ready-down.json --write-out '%{http_code}' \
  -H 'x-request-id: ready-redis-down' \
  http://127.0.0.1:3001/api/ready)
test "$READY_STATUS" = "503"
jq -e '.status == "unavailable" and .dependencies.postgresql.status == "ok" and .dependencies.redis.status == "unavailable"' ready-down.json

docker compose --env-file .env.docker start redis
timeout 60 bash -c 'until docker compose --env-file .env.docker exec -T redis redis-cli ping | grep -q PONG; do sleep 1; done'
sleep 2
curl --fail --silent http://127.0.0.1:3001/api/ready > ready-recovered.json
jq -e '.status == "ok" and .dependencies.redis.status == "ok"' ready-recovered.json

ERROR_STATUS=$(curl --silent --output error.json --dump-header error.headers --write-out '%{http_code}' \
  -H 'x-request-id: error-request' \
  http://127.0.0.1:3001/api/does-not-exist)
test "$ERROR_STATUS" = "404"
jq -e '.statusCode == 404 and .requestId == "error-request"' error.json
grep -qi '^x-request-id: error-request' error.headers

jq -R -e 'fromjson? | select(.message == "readiness.probe_failed" and .dependency == "redis")' api.log >/dev/null
jq -R -e 'fromjson? | select(.message == "http.request_completed" and .requestId == "ready-redis-down" and .statusCode == 503)' api.log >/dev/null
jq -R -e 'fromjson? | select(.message == "http.request_failed" and .requestId == "error-request")' api.log >/dev/null
! jq -R -e 'fromjson? | select(.message == "http.request_completed" and (.requestId == "health-silent" or .requestId == "ready-healthy"))' api.log >/dev/null

! grep -Fq "$DATABASE_URL" api.log
! grep -Fq "$REDIS_URL" api.log
! grep -Fq 'booking:booking' api.log
! grep -Fiq 'authorization' api.log
! grep -Fiq 'cookie' api.log
! grep -Fq '?q=' api.log

kill -TERM "$API_PID"
set +e
wait "$API_PID"
API_EXIT=$?
set -e
test "$API_EXIT" = "0" || test "$API_EXIT" = "143"
API_PID=0
! grep -Fiq 'unhandledrejection' api.log
```

Adjust `cleanup()` to skip `kill` when `API_PID=0`.

- [ ] **Step 3: Commit the temporary workflow and wait for a green run**

```bash
git add .github/workflows/api-runtime-smoke.yml
git commit -m "test: add temporary API runtime smoke"
git push
```

Record the successful workflow run ID and commit SHA for the pull-request description.

- [ ] **Step 4: Remove the temporary workflow immediately after evidence is captured**

```bash
git rm .github/workflows/api-runtime-smoke.yml
git commit -m "chore: remove temporary API runtime smoke"
git push
```

Confirm the final branch tree contains no runtime-smoke workflow.

- [ ] **Step 5: Verify the unified CI on the clean final tree**

Wait for all six existing jobs to pass:

```text
Quality
Unit tests
Build
Security
Knowledge validation
Docker Compose configuration
```

Fetch job logs for any failure and fix the implementation rather than rerunning blindly.

- [ ] **Step 6: Mark the Sprint 0 item complete**

Only after Steps 1–5 are green, change exactly:

```text
- [ ] Health, readiness, requestId và structured logging.
```

into:

```text
- [x] Health, readiness, requestId và structured logging.
```

Leave environment conventions, custom-domain routing, OpenAPI, tenant context, and Playwright unchecked.

- [ ] **Step 7: Commit the backlog update and re-run final CI**

```bash
git add docs/backlog/SPRINT-0.md
git commit -m "docs: complete API runtime foundation backlog"
git push
```

Wait for unified CI on this exact final commit and record the run ID.

- [ ] **Step 8: Final secret and tree inspection**

Run:

```bash
git status --short
git ls-files .github/workflows
pnpm audit --audit-level high
pnpm test
pnpm build
```

Expected:

- clean working tree;
- only permanent workflows remain;
- no high/critical dependency audit failure;
- tests and builds pass.

- [ ] **Step 9: Commit state**

No additional commit is required when Step 8 is clean. Use the exact final commit SHA for code review and pull-request merge verification.
