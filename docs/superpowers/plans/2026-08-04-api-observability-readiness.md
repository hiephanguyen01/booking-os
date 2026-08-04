# API Observability and Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Sprint 0 API runtime foundation with safe request-ID propagation, structured HTTP/error logging, real PostgreSQL and Redis readiness probes, bounded caching, deterministic tests, and verified outage recovery.

**Architecture:** Add a global `ObservabilityModule` for HTTP transport concerns, a `DependenciesModule` for lazy singleton clients and isolated probes, and a `HealthModule` readiness coordinator that consumes probe abstractions. Preserve the existing `HealthResponse` and `StructuredLogger` contracts; do not add an ORM, a second logger, tracing, metrics, or a health framework.

**Tech Stack:** Node.js 22, TypeScript 5.9, NestJS 11.1.28 with Express 5, `pg` 8.22.0, `ioredis` 5.11.1, Zod 4.4.3, Node test runner, Supertest, pnpm 10.34.5, Turborepo, Docker Compose, GitHub Actions.

## Global Constraints

- `GET /api/health` is process liveness only and remains HTTP `200` during dependency outages.
- `GET /api/ready` is HTTP `200` only when both `SELECT 1` and `PING` succeed; otherwise it returns HTTP `503` with `HealthResponse`.
- `READINESS_TIMEOUT_MS` defaults to `750` and accepts only integers from `100` through `5000`.
- Readiness results, including failures, are cached for `1000ms`; simultaneous callers share one in-flight run.
- Preserve upstream `x-request-id` only when it matches `^[A-Za-z0-9._:-]{1,128}$`; otherwise use `crypto.randomUUID()`.
- Every response returns `x-request-id`; normalized error bodies contain the same value.
- Ordinary requests emit one `http.request_completed`; exceptions also emit one `http.request_failed`.
- Successful `/api/health` and `/api/ready` responses do not emit completion logs; readiness `503` does.
- Never log bodies, raw query values, cookies, authorization, client URLs, credentials, IP addresses, or user agents.
- Public dependency reasons are exactly `timeout`, `connection_failed`, or `unexpected_response`.
- API bootstrap must not connect eagerly to PostgreSQL or Redis.
- Use NestJS 11 / Express 5 middleware wildcard `"{*splat}"`, not bare `"*"`.
- Keep exact dependency versions and frozen-install compatibility.
- Do not mark the backlog item complete until clean verification, runtime smoke, security, and final CI pass.

---

## File Structure

### Configuration

- Modify `apps/api/package.json`: add dependencies and include deterministic e2e in the standard `test` script.
- Modify `pnpm-lock.yaml`: exact resolved graph.
- Modify `apps/api/src/config/environment.schema.ts`: `READINESS_TIMEOUT_MS` validation and transform.
- Modify `apps/api/src/config/environment.schema.test.ts`: default, valid, boundary, and invalid tests.
- Modify `apps/api/src/config/environment.service.ts`: `readinessTimeoutMs` getter.
- Modify `apps/api/src/health/health.service.test.ts`: keep the typed `Environment` fixture complete.
- Modify `apps/api/.env.example`: readiness timeout example.

### HTTP observability

- Create `apps/api/src/observability/tokens.ts`: logger, request-ID generator, monotonic clock, and wall clock tokens.
- Create `apps/api/src/observability/request-context.ts`: Express request carrying `requestId`.
- Create `apps/api/src/observability/request-id.ts` and `.test.ts`: pure validation/selection.
- Create `apps/api/src/observability/request-id.middleware.ts` and `.test.ts`: attach and echo the ID.
- Create `apps/api/src/observability/route-resolver.ts` and `.test.ts`: route template or safe pathname.
- Create `apps/api/src/observability/http-logging.interceptor.ts` and `.test.ts`: one completion event.
- Create `apps/api/src/observability/api-error-response.ts` and `.test.ts`: public error mapping.
- Create `apps/api/src/observability/api-exception.filter.ts` and `.test.ts`: failure event and response.
- Create `apps/api/src/observability/observability.module.ts`: global providers and middleware.

### Dependency clients and probes

- Create `apps/api/src/dependencies/tokens.ts`: client and probe tokens.
- Create `apps/api/src/dependencies/ports.ts`: minimal testable client interfaces.
- Create `apps/api/src/dependencies/dependency-clients.ts` and `.test.ts`: lazy factories and safe event listeners.
- Create `apps/api/src/dependencies/dependency-lifecycle.service.ts` and `.test.ts`: idempotent cleanup.
- Create `apps/api/src/dependencies/readiness-probe.ts`: dependency/reason types and interface.
- Create `apps/api/src/dependencies/readiness-failure.ts` and `.test.ts`: safe classification.
- Create `apps/api/src/dependencies/postgresql-readiness.probe.ts` and `.test.ts`: `SELECT 1`.
- Create `apps/api/src/dependencies/redis-readiness.probe.ts` and `.test.ts`: `PING`/`PONG`.
- Create `apps/api/src/dependencies/dependencies.module.ts`: singleton clients, lifecycle, and exported probes.

### Health policy

- Create `apps/api/src/health/readiness-timeout.ts` and `.test.ts`: bounded settlement without late unhandled rejection.
- Create `apps/api/src/health/health-response.factory.ts` and `.test.ts`: common metadata/uptime.
- Create `apps/api/src/health/readiness-coordinator.ts` and `.test.ts`: concurrency, timeout, cache, deduplication, and logs.
- Modify `apps/api/src/health/health.service.ts` and `.test.ts`: liveness plus coordinator delegation.
- Modify `apps/api/src/health/health.controller.ts`: readiness HTTP status without throwing.
- Modify `apps/api/src/health/health.module.ts`: provider wiring.
- Modify `apps/api/src/app.module.ts`: import the three modules once.

### Integration and delivery

- Modify `apps/api/test/health.e2e.test.ts`: deterministic full-HTTP behavior with provider overrides.
- Modify `README.md`: runtime contract and smoke commands.
- Modify `docs/backlog/SPRINT-0.md`: checkbox only after final evidence.
- Temporarily create then delete `.github/workflows/api-runtime-smoke.yml`, `.github/scripts/api-runtime-smoke.sh`, and `apps/api/test/runtime-smoke-app.ts`.

---

### Task 1: Pin dependencies and extend the environment contract

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/api/src/config/environment.schema.ts`
- Modify: `apps/api/src/config/environment.schema.test.ts`
- Modify: `apps/api/src/config/environment.service.ts`
- Modify: `apps/api/src/health/health.service.test.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: `parseEnvironment(source: unknown): Environment`.
- Produces: `Environment.readinessTimeoutMs` and `EnvironmentService.readinessTimeoutMs`.

- [ ] **Step 1: Write failing environment tests**

Add `READINESS_TIMEOUT_MS: "900"` to `validEnvironment` and assert `readinessTimeoutMs: 900` in the transformed object. Add:

```ts
test("parseEnvironment defaults readiness timeout to 750", () => {
  const environment = parseEnvironment({
    DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking_os",
    REDIS_URL: "redis://localhost:6379/0",
  });
  assert.equal(environment.readinessTimeoutMs, 750);
});

test("parseEnvironment accepts readiness timeout boundaries", () => {
  assert.equal(parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: "100" }).readinessTimeoutMs, 100);
  assert.equal(parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: "5000" }).readinessTimeoutMs, 5000);
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

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- src/config/environment.schema.test.ts
```

Expected: FAIL because the field is absent.

- [ ] **Step 3: Add exact dependencies**

```bash
pnpm --filter @booking-os/api add pg@8.22.0 ioredis@5.11.1
pnpm --filter @booking-os/api add -D @types/express@5.0.6 @types/pg@8.20.0
```

- [ ] **Step 4: Implement schema, transform, getter, and fixtures**

Add to the Zod object:

```ts
READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(5000).default(750),
```

Add to the transformed value:

```ts
readinessTimeoutMs: values.READINESS_TIMEOUT_MS,
```

Add to `EnvironmentService`:

```ts
get readinessTimeoutMs(): number {
  return this.values.readinessTimeoutMs;
}
```

Add `readinessTimeoutMs: 750` to the typed `testEnvironment` in `health.service.test.ts`. Add to `.env.example`:

```dotenv
READINESS_TIMEOUT_MS=750
```

- [ ] **Step 5: Verify GREEN and frozen install**

```bash
pnpm --filter @booking-os/api test -- src/config/environment.schema.test.ts
pnpm --filter @booking-os/api typecheck
pnpm install --frozen-lockfile
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/config apps/api/src/health/health.service.test.ts apps/api/.env.example
git commit -m "feat(api): add readiness timeout configuration"
```

---

### Task 2: Add the API logger and safe request-ID middleware

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
- Consumes: `createStructuredLogger({ service: "api" })`.
- Produces: logger/clock tokens, `RequestWithContext`, `selectRequestId`, and middleware applied to `"{*splat}"`.

- [ ] **Step 1: Write failing pure request-ID tests**

```ts
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

Also assert the generator is not called for an accepted value.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- src/observability/request-id.test.ts
```

- [ ] **Step 3: Implement tokens and pure selection**

```ts
export const API_LOGGER_TOKEN = Symbol("API_LOGGER");
export const REQUEST_ID_GENERATOR_TOKEN = Symbol("REQUEST_ID_GENERATOR");
export const MONOTONIC_CLOCK_TOKEN = Symbol("MONOTONIC_CLOCK");
export const WALL_CLOCK_TOKEN = Symbol("WALL_CLOCK");

export type ApiLogger = StructuredLogger;
export type RequestIdGenerator = () => string;
export type MonotonicClock = () => number;
export type WallClock = () => Date;
```

```ts
export interface RequestWithContext extends Request {
  requestId: string;
}
```

```ts
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

- [ ] **Step 4: Write failing middleware tests**

Instantiate `RequestIdMiddleware` with `() => "generated-1"`. Assert one `next()` call, mutation of `request.requestId`, matching response header, valid upstream preservation, and rejected input replacement.

- [ ] **Step 5: Implement middleware and global module**

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

```ts
@Global()
@Module({
  providers: [
    { provide: API_LOGGER_TOKEN, useFactory: () => createStructuredLogger({ service: "api" }) },
    { provide: REQUEST_ID_GENERATOR_TOKEN, useValue: randomUUID },
    { provide: MONOTONIC_CLOCK_TOKEN, useValue: () => performance.now() },
    { provide: WALL_CLOCK_TOKEN, useValue: () => new Date() },
    RequestIdMiddleware,
  ],
  exports: [API_LOGGER_TOKEN, MONOTONIC_CLOCK_TOKEN, WALL_CLOCK_TOKEN],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*splat}");
  }
}
```

Import `ObservabilityModule` once in `AppModule`.

- [ ] **Step 6: Verify GREEN**

```bash
pnpm --filter @booking-os/api test -- src/observability/request-id.test.ts src/observability/request-id.middleware.test.ts
pnpm --filter @booking-os/api typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/observability apps/api/src/app.module.ts
git commit -m "feat(api): propagate safe request IDs"
```

---

### Task 3: Add safe route resolution and completion logging

**Files:**
- Create: `apps/api/src/observability/route-resolver.ts`
- Create: `apps/api/src/observability/route-resolver.test.ts`
- Create: `apps/api/src/observability/http-logging.interceptor.ts`
- Create: `apps/api/src/observability/http-logging.interceptor.test.ts`
- Modify: `apps/api/src/observability/observability.module.ts`

**Interfaces:**
- Consumes: request context, logger, monotonic clock, and `EnvironmentService.apiPrefix`.
- Produces: `resolveRequestRoute`, health-log suppression, and global `APP_INTERCEPTOR` registration.

- [ ] **Step 1: Write failing route tests**

```ts
assert.equal(resolveRequestRoute({ baseUrl: "/api", route: { path: "/bookings/:id" } } as Request), "/api/bookings/:id");
assert.equal(resolveRequestRoute({ baseUrl: "", route: { path: "/api/health" } } as Request), "/api/health");
assert.equal(resolveRequestRoute({ originalUrl: "/api/search?q=secret" } as Request), "/api/search");
assert.equal(isSuccessfulHealthRoute("/api/health", 200, "api"), true);
assert.equal(isSuccessfulHealthRoute("/api/ready", 200, "api"), true);
assert.equal(isSuccessfulHealthRoute("/api/ready", 503, "api"), false);
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- src/observability/route-resolver.test.ts
```

- [ ] **Step 3: Implement route resolution**

Join `baseUrl` and string `route.path` when available. Otherwise use `new URL(request.originalUrl, "http://localhost").pathname`. Normalize duplicate slashes, force a leading slash, and never return the query string.

- [ ] **Step 4: Write failing interceptor tests**

Use an `EventEmitter` response double. Set `statusCode`, emit `finish` twice, and assert one record containing request ID, method, route template, status, measured duration, and `info` level. Add tests for `warn` at `>=500`, suppression of successful health/readiness, logging readiness `503`, safe fallback pathname, and no duplicate record.

- [ ] **Step 5: Implement and globally register the interceptor**

Register `response.once("finish", ...)` before `next.handle()`. Use a local `logged` guard and final status. Round duration to at most three decimals. Log below `500` with `info`, otherwise `warn`.

```ts
{
  provide: APP_INTERCEPTOR,
  useClass: HttpLoggingInterceptor,
}
```

- [ ] **Step 6: Verify GREEN**

```bash
pnpm --filter @booking-os/api test -- src/observability/route-resolver.test.ts src/observability/http-logging.interceptor.test.ts
pnpm --filter @booking-os/api typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/observability
git commit -m "feat(api): add structured HTTP completion logs"
```

---

### Task 4: Normalize errors and emit failure logs

**Files:**
- Create: `apps/api/src/observability/api-error-response.ts`
- Create: `apps/api/src/observability/api-error-response.test.ts`
- Create: `apps/api/src/observability/api-exception.filter.ts`
- Create: `apps/api/src/observability/api-exception.filter.test.ts`
- Modify: `apps/api/src/observability/observability.module.ts`

**Interfaces:**
- Consumes: request context, route resolver, and API logger.
- Produces: `ApiErrorResponse`, `normalizeApiError`, and global `APP_FILTER` registration.

- [ ] **Step 1: Write failing mapper tests**

Assert a `BadRequestException("Invalid input")` maps to:

```ts
{
  statusCode: 400,
  body: {
    statusCode: 400,
    error: "Bad Request",
    message: "Invalid input",
    requestId: "request-1",
  },
}
```

Also cover a validation message array, ignored extra fields, a `503` whose internal message is hidden, and an unknown error mapping to fixed `500` output.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- src/observability/api-error-response.test.ts
```

- [ ] **Step 3: Implement the mapper**

Use `HttpException.getStatus()`, `getResponse()`, and `STATUS_CODES`. Return only string/string-array messages and a string `error`. For status `>=500`, ignore the payload and return `"An unexpected error occurred"`.

- [ ] **Step 4: Write failing filter tests**

Use request/response/`ArgumentsHost` doubles and captured records. Assert status/body, matching request IDs, exactly one `http.request_failed`, original exception serialization, and absence of body/query/header/cookie/environment fields.

- [ ] **Step 5: Implement and register the filter**

```ts
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithContext>();
    const response = http.getResponse<Response>();
    const normalized = normalizeApiError(exception, request.requestId);

    this.logger.child({ requestId: request.requestId }).error(
      "http.request_failed",
      exception,
      {
        method: request.method,
        route: resolveRequestRoute(request),
        statusCode: normalized.statusCode,
      },
    );

    response.status(normalized.statusCode).json(normalized.body);
  }
}
```

```ts
{
  provide: APP_FILTER,
  useClass: ApiExceptionFilter,
}
```

- [ ] **Step 6: Verify GREEN**

```bash
pnpm --filter @booking-os/api test -- src/observability
pnpm --filter @booking-os/api typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/observability
git commit -m "feat(api): normalize and log HTTP failures"
```

---

### Task 5: Create lazy dependency clients and idempotent cleanup

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
- Consumes: database/Redis URLs, readiness timeout, clocks, and logger.
- Produces: module-internal client tokens and testable lazy factories.

- [ ] **Step 1: Write failing factory tests**

Define constructor injection points:

```ts
type PostgresConstructor = (options: PoolConfig) => PostgresPoolPort;
type RedisConstructor = (url: string, options: RedisOptions) => RedisClientPort;

createPostgresPool(environment, constructPostgres);
createRedisClient(environment, constructRedis);
```

Assert PostgreSQL options `connectionString`, `connectionTimeoutMillis: 750`, and `query_timeout: 750`. Assert Redis options `lazyConnect: true`, `connectTimeout: 750`, `commandTimeout: 750`, and `maxRetriesPerRequest: 1`. Assert neither factory calls `query` nor `ping`, and both register an `error` listener.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- src/dependencies/dependency-clients.test.ts
```

- [ ] **Step 3: Implement ports and lazy factories**

```ts
export interface PostgresPoolPort {
  query(text: string): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
  on(event: "error", listener: (error: Error) => void): this;
}

export interface RedisClientPort {
  readonly status: string;
  ping(): Promise<string>;
  quit(): Promise<string>;
  disconnect(reconnect?: boolean): void;
  on(event: "error", listener: (error: Error) => void): this;
}
```

Default constructors return `new Pool(options)` and `new Redis(url, options)`. Register non-throwing error listeners without serializing raw errors or URLs.

- [ ] **Step 4: Write failing lifecycle tests**

Prove concurrent/repeated `close()` calls close once; rejected Redis `quit()` triggers `disconnect(false)`; rejected PostgreSQL close does not block Redis cleanup; cleanup failures emit `dependency.shutdown_failed` with only `dependency` plus logger-serialized error; and `onApplicationShutdown()` delegates to `close()`.

- [ ] **Step 5: Implement lifecycle cleanup**

```ts
private closePromise?: Promise<void>;

close(): Promise<void> {
  this.closePromise ??= this.closeResources();
  return this.closePromise;
}
```

Attempt both resources independently. Log safe failures and complete without exposing configuration.

- [ ] **Step 6: Wire `DependenciesModule` without exporting raw clients**

Provide pool, Redis client, and lifecycle service. Import `ObservabilityModule`. Export nothing yet; Task 6 exports probe tokens. Import `DependenciesModule` once in `AppModule`.

- [ ] **Step 7: Verify GREEN and lazy construction**

```bash
pnpm --filter @booking-os/api test -- src/dependencies/dependency-clients.test.ts src/dependencies/dependency-lifecycle.service.test.ts
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/api build
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/dependencies apps/api/src/app.module.ts
git commit -m "feat(api): add lazy dependency clients"
```

---

### Task 6: Implement PostgreSQL and Redis probes

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
- Consumes: client ports and monotonic clock.
- Produces: `ReadinessProbe`, safe reason types, and two exported probe tokens.

- [ ] **Step 1: Write failing classification tests**

```ts
for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "28P01", "08006"]) {
  assert.equal(classifyReadinessError(Object.assign(new Error("internal"), { code })), "connection_failed");
}
assert.equal(classifyReadinessError(new Error("WRONGPASS invalid username-password pair")), "connection_failed");
assert.equal(classifyReadinessError(new Error("NOAUTH Authentication required")), "connection_failed");
assert.equal(classifyReadinessError(new Error("parser failure")), "unexpected_response");
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- src/dependencies/readiness-failure.test.ts
```

- [ ] **Step 3: Define contracts and classifier**

```ts
export type ReadinessDependency = "postgresql" | "redis";
export type ReadinessFailureReason = "timeout" | "connection_failed" | "unexpected_response";

export interface ReadinessProbe {
  readonly dependency: ReadinessDependency;
  check(): Promise<HealthDependencyStatus>;
}
```

Classify Node/socket codes, PostgreSQL SQLSTATE classes `08` and `28`, and fixed Redis authentication prefixes. Never return raw messages.

- [ ] **Step 4: Write PostgreSQL probe tests**

Assert one `query("SELECT 1 AS ready")`, expected row validation, injected-clock latency, safe connection failure, safe unexpected result, and no raw exception text.

- [ ] **Step 5: Implement PostgreSQL probe**

Return `ok` only for one row whose `ready` property is `1`. Catch client errors and use the classifier. Round latency to at most three decimals.

- [ ] **Step 6: Write Redis probe tests**

Assert exact uppercase `PONG` success; lowercase/other replies become `unexpected_response`; coded rejection becomes `connection_failed`; latency is measured; raw messages are absent.

- [ ] **Step 7: Implement Redis probe and module providers**

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

Export only the probe tokens.

- [ ] **Step 8: Verify GREEN**

```bash
pnpm --filter @booking-os/api test -- src/dependencies
pnpm --filter @booking-os/api typecheck
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/dependencies
git commit -m "feat(api): add dependency readiness probes"
```

---

### Task 7: Add timeout, response factory, cache, and deduplication

**Files:**
- Create: `apps/api/src/health/readiness-timeout.ts`
- Create: `apps/api/src/health/readiness-timeout.test.ts`
- Create: `apps/api/src/health/health-response.factory.ts`
- Create: `apps/api/src/health/health-response.factory.test.ts`
- Create: `apps/api/src/health/readiness-coordinator.ts`
- Create: `apps/api/src/health/readiness-coordinator.test.ts`

**Interfaces:**
- Consumes: both probes, environment timeout, logger, monotonic clock, and wall clock.
- Produces: `ReadinessResult` and `ReadinessCoordinator.getReadiness(requestId?: string)`.

- [ ] **Step 1: Write failing timeout tests**

Test immediate resolve, immediate reject, deadline rejection with `ReadinessTimeoutError`, timer cleanup, and a late underlying rejection that does not emit `unhandledRejection`.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- src/health/readiness-timeout.test.ts
```

- [ ] **Step 3: Implement timeout helper**

Use one timer. Attach fulfillment and rejection handlers to the underlying promise, clear the timer in every path, and reject timeout with no client detail.

- [ ] **Step 4: Write response-factory tests**

With injected clocks, assert service, status, version, deterministic ISO timestamp, integer uptime, dependency map, and non-negative uptime.

- [ ] **Step 5: Implement `HealthResponseFactory`**

Inject `EnvironmentService`, `MONOTONIC_CLOCK_TOKEN`, and `WALL_CLOCK_TOKEN`. Capture monotonic start once. Do not read `process.env`.

- [ ] **Step 6: Write coordinator tests**

Required cases:

1. both probes begin before either resolves;
2. both `ok` produce HTTP `200`;
3. one/both unavailable produce HTTP `503` while preserving statuses;
4. never-resolving probes map independently to `timeout`;
5. duration is near the slower timeout, not the sum;
6. success and failure are cached for `1000ms`;
7. expiry triggers a new pair;
8. simultaneous callers share one promise/pair;
9. `inFlight` clears after success and unexpected rejection;
10. actual failed probes emit one `readiness.probe_failed` with request ID, dependency, duration, and reason;
11. cache hits emit no additional failure event.

- [ ] **Step 7: Implement coordinator**

```ts
export interface ReadinessResult {
  readonly statusCode: 200 | 503;
  readonly body: HealthResponse;
}
```

```ts
async getReadiness(requestId?: string): Promise<ReadinessResult> {
  const now = this.now();
  if (this.cachedResult && this.cachedResult.expiresAt > now) return this.cachedResult.result;
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

Start both wrapped checks before `Promise.all`. Convert only `ReadinessTimeoutError` to `timeout`. Let escaped implementation errors reach the global filter.

- [ ] **Step 8: Verify GREEN**

```bash
pnpm --filter @booking-os/api test -- src/health/readiness-timeout.test.ts src/health/health-response.factory.test.ts src/health/readiness-coordinator.test.ts
pnpm --filter @booking-os/api typecheck
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/health
git commit -m "feat(api): coordinate cached readiness checks"
```

---

### Task 8: Integrate readiness into health endpoints

**Files:**
- Modify: `apps/api/src/health/health.service.ts`
- Modify: `apps/api/src/health/health.service.test.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: response factory and coordinator.
- Produces: `getHealth()` and asynchronous `getReadiness(requestId?)` with controller-selected HTTP status.

- [ ] **Step 1: Replace the old empty-map test with failing delegation tests**

Assert `getHealth()` returns factory liveness without calling probes and `getReadiness("request-1")` returns the coordinator result while forwarding the ID.

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/api test -- src/health/health.service.test.ts
```

- [ ] **Step 3: Implement service/controller integration**

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

Do not throw `ServiceUnavailableException`.

- [ ] **Step 4: Wire modules**

`HealthModule` imports `DependenciesModule`, provides response factory/coordinator/service, and injects probe tokens. `AppModule` imports:

```ts
[EnvironmentModule, ObservabilityModule, DependenciesModule, HealthModule]
```

Leave `main.ts` focused on dotenv, Nest bootstrap, shutdown hooks, global prefix, listen, and service events.

- [ ] **Step 5: Verify GREEN**

```bash
pnpm --filter @booking-os/api test -- src
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/api build
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/health apps/api/src/app.module.ts
git commit -m "feat(api): expose real readiness status"
```

---

### Task 9: Add deterministic HTTP e2e and enforce it in `pnpm test`

**Files:**
- Modify: `apps/api/test/health.e2e.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: probe, logger, and request-ID generator tokens.
- Produces: full-HTTP behavior without Docker and a standard test script covering unit plus e2e.

- [ ] **Step 1: Build the test application with overrides**

```ts
const postgresProbe = { dependency: "postgresql" as const, check: async () => postgresStatus };
const redisProbe = { dependency: "redis" as const, check: async () => redisStatus };

const testingModule = await Test.createTestingModule({
  imports: [AppModule],
  controllers: [TestErrorController],
})
  .overrideProvider(POSTGRES_READINESS_PROBE_TOKEN).useValue(postgresProbe)
  .overrideProvider(REDIS_READINESS_PROBE_TOKEN).useValue(redisProbe)
  .overrideProvider(API_LOGGER_TOKEN).useValue(capturedLogger)
  .overrideProvider(REQUEST_ID_GENERATOR_TOKEN).useValue(() => "generated-request-id")
  .compile();
```

The test-only controller throws at `GET /api/test/boom`.

- [ ] **Step 2: Add failing e2e cases**

Cover `/api/health` with generated header; valid ID preservation; invalid replacement; readiness `200`; Redis-unavailable `503` with PostgreSQL still `ok`; redacted `500` with matching IDs; successful-health log suppression; readiness-failure events; and error failure/completion events.

Use a fresh Nest app/coordinator per test group so cache cannot make tests order-dependent.

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter @booking-os/api test:e2e
```

- [ ] **Step 4: Fix integration defects without weakening contracts**

Keep fixes inside defined modules. Do not add test routes to production modules.

- [ ] **Step 5: Enforce e2e in the standard test script**

```json
"test": "node --test --import tsx \"src/**/*.test.ts\" \"test/**/*.test.ts\""
```

Keep `test:e2e`.

- [ ] **Step 6: Run twice to detect leaked listeners/state**

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api typecheck
pnpm --filter @booking-os/api build
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/health.e2e.test.ts apps/api/package.json
git commit -m "test(api): cover request observability and readiness"
```

---

### Task 10: Document the runtime contract

**Files:**
- Modify: `README.md`
- Modify: `apps/api/.env.example` only if placement/format needs alignment.

**Interfaces:**
- Consumes: final behavior.
- Produces: operator/developer documentation matching implementation.

- [ ] **Step 1: Document endpoints**

```text
GET http://localhost:3001/api/health  -> liveness, HTTP 200 while serving
GET http://localhost:3001/api/ready   -> PostgreSQL + Redis readiness, HTTP 200 or 503
```

State `SELECT 1`, `PING`, both required, and one-second cache.

- [ ] **Step 2: Document request ID and error envelope**

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "requestId": "43c2387d-98c8-4e73-9f67-a32f36c945df"
}
```

State request IDs are correlation values, not authentication proof.

- [ ] **Step 3: Document events and forbidden fields**

List `http.request_completed`, `http.request_failed`, `readiness.probe_failed`, and `dependency.shutdown_failed`. State bodies, raw query values, cookies, authorization, credentials, and URLs are excluded.

- [ ] **Step 4: Document configuration and smoke commands**

```dotenv
READINESS_TIMEOUT_MS=750
```

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d postgres redis
cp apps/api/.env.example apps/api/.env
pnpm --filter @booking-os/api dev
curl -i http://localhost:3001/api/health
curl -i http://localhost:3001/api/ready
```

State `apps/api/.env` is local-only and must not be committed.

- [ ] **Step 5: Verify and commit**

```bash
pnpm check:ci
python tools/genesis_cli.py validate
git add README.md apps/api/.env.example
git commit -m "docs: describe API readiness and request observability"
```

---

### Task 11: Run real startup/outage/recovery smoke, final checks, and close the backlog item

**Files:**
- Temporarily create: `.github/workflows/api-runtime-smoke.yml`
- Temporarily create: `.github/scripts/api-runtime-smoke.sh`
- Temporarily create: `apps/api/test/runtime-smoke-app.ts`
- Delete before final tree: all three temporary files.
- Modify after all evidence passes: `docs/backlog/SPRINT-0.md`

**Interfaces:**
- Consumes: complete branch and real Docker PostgreSQL/Redis.
- Produces: evidence for lazy startup, liveness/readiness separation, outage recovery, real `500` normalization, safe logs, shutdown, clean final tree, and green CI.

- [ ] **Step 1: Run clean verification**

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

All commands must PASS without relaxing gates.

- [ ] **Step 2: Create the temporary runtime harness**

Create `apps/api/test/runtime-smoke-app.ts`:

```ts
import "reflect-metadata";

import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module.js";
import { EnvironmentService } from "../src/config/environment.service.js";

@Controller("runtime-smoke")
class RuntimeSmokeController {
  @Get("boom")
  boom(): never {
    throw new Error("runtime smoke internal detail");
  }
}

@Module({
  imports: [AppModule],
  controllers: [RuntimeSmokeController],
})
class RuntimeSmokeModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(RuntimeSmokeModule, { bufferLogs: true });
  const environment = app.get(EnvironmentService);

  app.enableShutdownHooks();
  app.setGlobalPrefix(environment.apiPrefix);
  await app.listen(environment.port, environment.host);
}

bootstrap().catch(() => {
  process.exitCode = 1;
});
```

This imports the real `AppModule` and adds only a temporary error route for the smoke run.

- [ ] **Step 3: Create the temporary workflow**

```yaml
name: API Runtime Smoke

on:
  workflow_dispatch:
  push:
    branches:
      - feat/api-observability-readiness

permissions:
  contents: read

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
        with:
          version: 10.34.5
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: cp .env.docker.example .env.docker
      - run: docker compose --env-file .env.docker up -d postgres
      - run: pnpm --filter @booking-os/api build
      - name: Verify runtime behavior
        run: bash .github/scripts/api-runtime-smoke.sh
      - name: Upload API log on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: api-runtime-smoke-log
          path: api.log
      - name: Cleanup Compose
        if: always()
        run: docker compose --env-file .env.docker down --volumes --remove-orphans
```

Redis is deliberately absent when the API starts.

- [ ] **Step 4: Create the executable smoke script**

Create `.github/scripts/api-runtime-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=test HOST=127.0.0.1 PORT=3001 API_PREFIX=api APP_VERSION=runtime-smoke LOG_LEVEL=debug
export DATABASE_URL=postgresql://booking:booking@localhost:5432/booking_os
export REDIS_URL=redis://localhost:6379/0
export READINESS_TIMEOUT_MS=500

timeout 90 bash -c 'until docker compose --env-file .env.docker exec -T postgres pg_isready -U booking -d booking_os; do sleep 1; done'

pnpm --filter @booking-os/api exec tsx test/runtime-smoke-app.ts > api.log 2>&1 &
API_PID=$!
cleanup() {
  if [ "${API_PID:-0}" -gt 0 ]; then
    kill -TERM "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

timeout 60 bash -c 'until curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null; do sleep 1; done'

curl --fail --silent -H 'x-request-id: health-redis-down' -D health.headers http://127.0.0.1:3001/api/health > health.json
grep -qi '^x-request-id: health-redis-down' health.headers
jq -e '.status == "ok"' health.json

STARTUP_READY_STATUS=$(curl --silent --output startup-ready.json --write-out '%{http_code}' -H 'x-request-id: startup-redis-down' http://127.0.0.1:3001/api/ready)
test "$STARTUP_READY_STATUS" = "503"
jq -e '.status == "unavailable" and .dependencies.postgresql.status == "ok" and .dependencies.redis.status == "unavailable"' startup-ready.json

docker compose --env-file .env.docker up -d redis
timeout 60 bash -c 'until docker compose --env-file .env.docker exec -T redis redis-cli ping | grep -q PONG; do sleep 1; done'
sleep 2
curl --fail --silent -H 'x-request-id: ready-healthy' http://127.0.0.1:3001/api/ready > ready.json
jq -e '.status == "ok" and .dependencies.postgresql.status == "ok" and .dependencies.redis.status == "ok"' ready.json

docker compose --env-file .env.docker stop redis
sleep 2
OUTAGE_STATUS=$(curl --silent --output outage-ready.json --write-out '%{http_code}' -H 'x-request-id: outage-redis-down' http://127.0.0.1:3001/api/ready)
test "$OUTAGE_STATUS" = "503"
jq -e '.status == "unavailable" and .dependencies.postgresql.status == "ok" and .dependencies.redis.status == "unavailable"' outage-ready.json

docker compose --env-file .env.docker start redis
timeout 60 bash -c 'until docker compose --env-file .env.docker exec -T redis redis-cli ping | grep -q PONG; do sleep 1; done'
sleep 2
curl --fail --silent http://127.0.0.1:3001/api/ready > recovered-ready.json
jq -e '.status == "ok" and .dependencies.redis.status == "ok"' recovered-ready.json

ERROR_STATUS=$(curl --silent --output error.json --dump-header error.headers --write-out '%{http_code}' -H 'x-request-id: error-request' http://127.0.0.1:3001/api/runtime-smoke/boom)
test "$ERROR_STATUS" = "500"
jq -e '.statusCode == 500 and .error == "Internal Server Error" and .message == "An unexpected error occurred" and .requestId == "error-request"' error.json
grep -qi '^x-request-id: error-request' error.headers
! grep -Fq 'runtime smoke internal detail' error.json

jq -Rs -e 'split("\n") | map(fromjson?) | any(.message == "readiness.probe_failed" and .dependency == "redis")' api.log
jq -Rs -e 'split("\n") | map(fromjson?) | any(.message == "http.request_completed" and .requestId == "outage-redis-down" and .statusCode == 503)' api.log
jq -Rs -e 'split("\n") | map(fromjson?) | any(.message == "http.request_failed" and .requestId == "error-request" and .statusCode == 500)' api.log
jq -Rs -e 'split("\n") | map(fromjson?) | any(.message == "http.request_completed" and .requestId == "error-request" and .statusCode == 500)' api.log
jq -Rs -e 'split("\n") | map(fromjson?) | all(.message != "http.request_completed" or (.requestId != "health-redis-down" and .requestId != "ready-healthy"))' api.log

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

Run `chmod +x .github/scripts/api-runtime-smoke.sh`.

- [ ] **Step 5: Commit, push, and record a green smoke run**

```bash
git add .github/workflows/api-runtime-smoke.yml .github/scripts/api-runtime-smoke.sh apps/api/test/runtime-smoke-app.ts
git commit -m "test: add temporary API runtime smoke"
git push
```

Record run ID and commit SHA.

- [ ] **Step 6: Remove all temporary smoke files**

```bash
git rm .github/workflows/api-runtime-smoke.yml .github/scripts/api-runtime-smoke.sh apps/api/test/runtime-smoke-app.ts
git commit -m "chore: remove temporary API runtime smoke"
git push
```

Confirm all three are absent from the final tree.

- [ ] **Step 7: Verify the six permanent CI jobs**

Wait for `Quality`, `Unit tests`, `Build`, `Security`, `Knowledge validation`, and `Docker Compose configuration`. Diagnose failures from logs rather than rerunning blindly.

- [ ] **Step 8: Mark only the completed backlog item**

Change:

```text
- [ ] Health, readiness, requestId và structured logging.
```

into:

```text
- [x] Health, readiness, requestId và structured logging.
```

Leave environment conventions, custom-domain routing, OpenAPI, tenant context, and Playwright unchecked.

- [ ] **Step 9: Commit and verify final CI on the exact final SHA**

```bash
git add docs/backlog/SPRINT-0.md
git commit -m "docs: complete API runtime foundation backlog"
git push
```

Record the final CI run ID.

- [ ] **Step 10: Final tree and security inspection**

```bash
git status --short
git ls-files .github/workflows .github/scripts apps/api/test/runtime-smoke-app.ts
pnpm audit --audit-level high
pnpm test
pnpm build
```

Expected: clean tree, no temporary smoke files, no high/critical audit failure, tests/build PASS. No additional commit is needed when clean.
