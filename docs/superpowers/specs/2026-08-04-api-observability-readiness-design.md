# API Observability and Readiness Design

## Status

Approved design; pending written-spec review and implementation planning.

## Context

The repository now has a runnable NestJS API, two Next.js applications, two BullMQ workers, shared contracts, shared structured logging, Docker Compose infrastructure, and unified CI.

The API currently exposes liveness and readiness controller routes, but readiness returns an empty dependency map. API bootstrap emits structured service events, while HTTP requests do not yet have request-ID propagation, standardized access logs, or a normalized error response. PostgreSQL and Redis URLs are already validated by the API environment boundary, but the API does not own reusable clients or real dependency probes.

Sprint 0 contains one remaining P0 runtime-foundation item covering health, readiness, request ID, and structured logging. This design completes that item without adding tracing, metrics, authentication, tenancy, ORM usage, or product workflows.

With the current default global prefix, the public endpoints are:

```text
GET /api/health
GET /api/ready
```

References to `/health` and `/ready` below mean the corresponding controller routes under the configured API prefix.

## Goals

- Keep liveness independent from external dependencies.
- Make readiness prove that PostgreSQL and Redis can answer real application-level commands.
- Return HTTP `503` when either required dependency is unavailable.
- Preserve or generate a safe request ID for every HTTP request and return it in `x-request-id`.
- Include the same request ID in HTTP access logs, failure logs, and normalized error responses.
- Emit one structured completion event per ordinary HTTP request and a separate structured event for unhandled failures.
- Avoid noisy successful access logs for liveness and readiness probes.
- Keep dependency clients reusable and independent from the health controller.
- Start the API even when PostgreSQL or Redis is temporarily unavailable and recover readiness when they return.
- Add deterministic unit and API e2e coverage plus a real runtime smoke check.
- Update documentation and mark the Sprint 0 backlog item complete only after verification passes.

## Non-goals

- OpenTelemetry, distributed tracing, span propagation, or trace IDs.
- Prometheus metrics or another metrics backend.
- Log shipping, aggregation, retention, or alerting infrastructure.
- Authentication, authorization, sessions, tenant context, or audit logging.
- ORM adoption, migrations, repositories, or business queries.
- OpenAPI generation or moving the error envelope into a generated public contract.
- Kubernetes probes or deployment manifests.
- Repository-wide environment and secret conventions beyond the readiness timeout variable introduced here.
- Custom-domain local routing.
- Background readiness polling.
- Logging request or response bodies, raw query strings, cookies, authorization headers, IP addresses, or user agents.
- Logger transport changes or shared logger level-filtering changes.

## Selected approach

Use three focused NestJS modules:

- `ObservabilityModule` owns the API logger provider, request-ID middleware, HTTP completion logging, and global exception normalization.
- `DependenciesModule` owns singleton PostgreSQL and Redis clients, lifecycle cleanup, and isolated dependency probes.
- `HealthModule` owns liveness/readiness semantics and coordinates the probes without knowing client implementation details.

This keeps transport concerns, infrastructure clients, and health policy independently testable. It also creates reusable API foundations for later vertical slices without introducing a second logging framework or a health-framework abstraction that duplicates the existing shared contracts.

## Alternatives considered

### Put everything in `HealthModule` and `main.ts`

This would use fewer files initially, but it would mix request context, exception handling, client lifecycle, and health policy. Later product modules would either depend on health internals or duplicate client and logging behavior.

### Adopt `nestjs-pino` and `@nestjs/terminus`

These libraries provide mature integrations, but adopting them now would introduce a logging path parallel to `@booking-os/observability` and require adapter decisions beyond the Sprint 0 need. The selected design extends the existing structured logger and keeps the dependency surface small.

## Architecture

```text
AppModule
  ├── EnvironmentModule
  ├── ObservabilityModule
  ├── DependenciesModule
  └── HealthModule
          └── ReadinessCoordinator
                ├── PostgreSQLReadinessProbe
                └── RedisReadinessProbe
```

HTTP flow:

```text
incoming request
  -> RequestIdMiddleware
       -> preserve safe upstream ID or generate UUID
       -> attach request.requestId
       -> set response x-request-id
  -> HttpLoggingInterceptor
       -> capture start time and resolved route template
  -> controller/service
  -> ApiExceptionFilter when an exception escapes
       -> log http.request_failed
       -> write normalized error envelope
  -> response finish
       -> log http.request_completed unless successful health probe
```

Readiness flow:

```text
GET /api/ready
  -> HealthController
  -> HealthService
  -> ReadinessCoordinator
       -> return valid cache, or
       -> join in-flight check, or
       -> run both probes concurrently
            ├── PostgreSQL: SELECT 1
            └── Redis: PING
  -> HealthResponse
  -> controller sets HTTP 200 or 503
```

## Module boundaries

### `ObservabilityModule`

Responsibilities:

- Create and export one API `StructuredLogger` bound to `service: "api"`.
- Apply request-ID middleware to every API route.
- Register the HTTP logging interceptor globally.
- Register the API exception filter globally.
- Provide small HTTP request types and route-resolution helpers used by those components.

It must not:

- connect to PostgreSQL or Redis;
- implement health policy;
- inspect or log request bodies or sensitive headers;
- create request-scoped NestJS providers merely to carry the request ID.

The middleware attaches request context directly to the request object. The interceptor and exception filter derive child loggers from the singleton logger:

```ts
logger.child({ requestId })
```

This uses the existing shared logger contract and avoids request-scope overhead.

### `DependenciesModule`

Responsibilities:

- Create one lazy PostgreSQL pool from `DATABASE_URL`.
- Create one lazy Redis client from `REDIS_URL`.
- Handle client lifecycle and non-fatal background error events.
- Export probe abstractions rather than exposing client details to `HealthModule`.
- Close both clients during NestJS shutdown.

It must not:

- make API bootstrap depend on successful external connections;
- expose connection strings through logs or health responses;
- contain HTTP controllers;
- own readiness aggregation or caching policy.

The module may export client tokens later if product modules need them, but this scope exports only what the health implementation requires. Avoid prematurely defining a general database abstraction before an ORM or repository strategy exists.

### `HealthModule`

Responsibilities:

- Build the liveness response from process state and application metadata.
- Coordinate required dependency probes for readiness.
- Cache and deduplicate readiness work.
- Return a readiness result containing both the response body and desired HTTP status.

It must not:

- instantiate `pg` or Redis clients directly;
- format global API errors;
- inspect raw connection errors or expose connection details.

## Request ID contract

The canonical header is:

```text
x-request-id
```

An upstream value is accepted only when it matches:

```regex
^[A-Za-z0-9._:-]{1,128}$
```

This permits common gateway-generated identifiers while rejecting whitespace, line breaks, control characters, Unicode ambiguity, and oversized values that could cause log injection or unnecessary log volume.

Behavior:

1. Read the first `x-request-id` header value.
2. Preserve it when it passes validation.
3. Otherwise generate a new value with `crypto.randomUUID()`.
4. Assign the final value to `request.requestId`.
5. Set the same value on the response `x-request-id` header before downstream handling.
6. Never echo an invalid upstream value.

A local Express request extension provides compile-time access:

```ts
interface RequestWithContext extends Request {
  requestId: string;
}
```

Request IDs are correlation values, not authentication credentials and not proof that requests came from a trusted gateway.

## HTTP completion logging

The global HTTP logging interceptor records request start time and registers one completion handler against the response lifecycle. Logging after the response finishes ensures that the event uses the final status code, including responses written by the exception filter.

Representative event:

```json
{
  "service": "api",
  "level": "info",
  "message": "http.request_completed",
  "requestId": "43c2387d-98c8-4e73-9f67-a32f36c945df",
  "method": "GET",
  "route": "/api/bookings/:id",
  "statusCode": 200,
  "durationMs": 12,
  "timestamp": "2026-08-04T02:00:00.000Z"
}
```

Required fields:

```text
requestId
method
route
statusCode
durationMs
```

`durationMs` is an integer or bounded decimal derived from a monotonic clock, not wall-clock subtraction.

Log levels:

- `info` for final status codes below `500`;
- `warn` for final status codes `500` and above.

The route field prefers the resolved Express/NestJS route template plus the configured global prefix. For example, a request for `/api/bookings/123?expand=customer` is logged as:

```text
/api/bookings/:id
```

When a route template is unavailable, the logger falls back to the URL pathname with the query string removed. It never logs raw query values.

### Health-log suppression

Do not emit `http.request_completed` when all conditions are true:

- the resolved route is the configured health or readiness route;
- the final status code is `200`.

Therefore:

- successful `/api/health` is silent;
- successful `/api/ready` is silent;
- `/api/ready` returning `503` is logged;
- unexpected health-route errors are logged;
- `404`, `405`, or other non-success responses around those paths are logged.

Probe failures also emit their own `readiness.probe_failed` events. The `503` completion event remains useful for status and latency aggregation, while the probe event explains which dependency failed.

The implementation must guard against duplicate completion events. Only the response `finish` path produces the normal completion event in this scope; aborted-connection telemetry is deferred.

## Exception normalization

A global exception filter normalizes errors that escape controllers and services.

Response envelope:

```ts
interface ApiErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId: string;
}
```

Representative `500` response:

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "requestId": "43c2387d-98c8-4e73-9f67-a32f36c945df"
}
```

Rules:

- Known NestJS `HttpException` instances retain their HTTP status.
- For `4xx`, safe string or string-array messages from the exception payload may be returned.
- Object payloads are not copied wholesale into the response.
- The `error` field uses a safe exception error string when present, otherwise the standard HTTP status phrase.
- For every `5xx`, the public `message` is exactly `"An unexpected error occurred"` and the public `error` is the standard status phrase.
- Unknown exceptions become HTTP `500`.
- Stack traces, raw exception objects, internal codes, paths, and timestamps are not returned.
- The request ID in the body must equal the `x-request-id` response header.

Before writing the response, the filter emits:

```text
http.request_failed
```

The failure event is `error` level and includes:

```text
requestId
method
route
statusCode
```

The structured logger serializes the exception for internal diagnosis. The filter must not attach request bodies, query objects, headers, cookies, or environment objects to the event.

A failing request therefore normally creates two events:

1. `http.request_failed` with the exception.
2. `http.request_completed` with final status and duration.

This deliberate separation supports both debugging and stable HTTP status/latency aggregation.

## Liveness semantics

`GET /api/health` answers whether the API process is alive and can serve HTTP.

It does not call PostgreSQL, Redis, MinIO, Mailpit, or any external service.

When the process is serving requests, it returns HTTP `200`:

```json
{
  "service": "api",
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-08-04T02:00:00.000Z",
  "uptimeSeconds": 120
}
```

The existing `HealthResponse` contract remains the public response type.

## Readiness semantics

`GET /api/ready` answers whether the API can perform work that requires its two mandatory runtime dependencies:

```text
postgresql
redis
```

Both probes run concurrently. The API is ready only when both return a valid success result.

Successful response:

- HTTP `200`;
- top-level `status: "ok"`;
- both dependencies have `status: "ok"` and measured `latencyMs`.

```json
{
  "service": "api",
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-08-04T02:00:00.000Z",
  "uptimeSeconds": 120,
  "dependencies": {
    "postgresql": {
      "status": "ok",
      "latencyMs": 4
    },
    "redis": {
      "status": "ok",
      "latencyMs": 2
    }
  }
}
```

Failure response:

- HTTP `503`;
- top-level `status: "unavailable"`;
- each dependency keeps its actual result;
- a failed dependency has `status: "unavailable"` and one safe reason code.

```json
{
  "service": "api",
  "status": "unavailable",
  "version": "0.1.0",
  "timestamp": "2026-08-04T02:00:00.000Z",
  "uptimeSeconds": 120,
  "dependencies": {
    "postgresql": {
      "status": "unavailable",
      "latencyMs": 750,
      "message": "timeout"
    },
    "redis": {
      "status": "ok",
      "latencyMs": 3
    }
  }
}
```

The controller sets the status code directly from a readiness result rather than throwing a `ServiceUnavailableException`; throwing would route the intentional health body through the global API error envelope.

The current contract already supports `ok`, `degraded`, and `unavailable`. This scope uses `ok` and `unavailable` because both dependencies are mandatory. `degraded` remains available for future optional dependencies but is not emitted by this implementation.

## Probe abstractions

Each dependency probe implements one narrow interface:

```ts
interface ReadinessProbe {
  readonly dependency: "postgresql" | "redis";
  check(): Promise<HealthDependencyStatus>;
}
```

The coordinator depends on probes, not client libraries. Tests replace these providers with deterministic doubles.

### PostgreSQL probe

- Use one singleton `pg.Pool`.
- Let the pool connect lazily on the first query.
- Execute `SELECT 1`.
- Treat a successful query with the expected result as `ok`.
- Measure latency with a monotonic clock.
- Close the pool with `pool.end()` during shutdown.

The readiness query is not a migration check, schema check, replica-lag check, or transaction test.

### Redis probe

- Use one singleton `ioredis` client.
- Configure lazy initial connection.
- Execute `PING`.
- Treat only the expected `PONG` response as `ok`.
- Measure latency with a monotonic clock.
- Close gracefully with `quit()` during shutdown; use `disconnect()` as cleanup fallback when graceful close cannot complete.

The client has an error listener so transient connection errors cannot become unhandled EventEmitter errors. Background client errors do not terminate API bootstrap.

## Failure classification and sanitization

Public readiness reason codes are limited to:

```ts
type ReadinessFailureReason =
  | "timeout"
  | "connection_failed"
  | "unexpected_response";
```

Classification rules:

- A coordinator deadline produces `timeout`.
- Recognized network, socket, DNS, authentication, or client connection failures produce `connection_failed`.
- A command that resolves with an unexpected value, and errors that cannot safely be classified as connection failures, produce `unexpected_response`.

The public dependency status never contains the raw exception message, stack, host, port, URL, username, password, or client configuration.

For every failed probe, emit a warning event:

```text
readiness.probe_failed
```

Context:

```text
requestId, when a request triggered the probe
dependency
durationMs
reason
safe error code, when available
```

The internal event may include a sanitized error object and stack for diagnosis, but credentials and connection URLs must be removed. The implementation must not pass the environment object or connection options to the logger. Runtime smoke verification scans output to ensure known test URLs and credentials do not appear.

When a cached result is served, no new probe-failure event is emitted because no new probe ran.

## Timeout configuration

Add one environment variable:

```env
READINESS_TIMEOUT_MS=750
```

Validation:

- coerce to integer;
- minimum `100`;
- maximum `5000`;
- default `750`.

The same deadline applies independently to PostgreSQL and Redis. Since the probes run concurrently, the readiness endpoint normally completes near the slower probe deadline rather than the sum of both deadlines.

The coordinator deadline bounds how long the HTTP readiness request waits. Client-level connection and command timeouts should be configured consistently so timed-out operations do not continue indefinitely in the background.

The timeout wrapper must clean up its timer in every resolution path and must not create unhandled promise rejections after a timeout wins the race.

## Readiness cache and concurrent deduplication

The coordinator maintains:

```ts
interface CachedReadiness {
  expiresAt: number;
  response: HealthResponse;
}

private cachedResult?: CachedReadiness;
private inFlight?: Promise<HealthResponse>;
```

TTL is fixed at `1000ms` in this scope; no additional environment variable is introduced.

Algorithm:

1. If a cached response has not expired, return it.
2. If a probe run is already in flight, return the same promise.
3. Otherwise start PostgreSQL and Redis probes concurrently.
4. Aggregate both results into one `HealthResponse`.
5. Cache the response for one second, including unavailable responses.
6. Clear `inFlight` in `finally`, regardless of success or unexpected failure.

Caching unavailable results prevents aggressive health checkers from amplifying an outage. Concurrent deduplication ensures a burst of readiness requests produces only one PostgreSQL query and one Redis command.

A cached readiness response may retain a timestamp and uptime value up to one second old. That bounded staleness is acceptable for a probe endpoint and is documented by the cache TTL.

Unexpected coordinator implementation errors are not converted silently into a normal dependency response. They propagate to the global exception filter, produce a normalized `500`, and are covered by tests.

## Startup and shutdown behavior

API startup must not require PostgreSQL or Redis to be reachable.

Startup sequence:

```text
load and validate environment
  -> construct NestJS application
  -> construct lazy dependency clients
  -> register HTTP observability
  -> listen for HTTP traffic
  -> emit service-ready event
```

When dependencies are unavailable at startup:

- API bootstrap still succeeds;
- `/api/health` returns `200`;
- `/api/ready` returns `503`;
- later readiness calls recover automatically when clients can connect again.

Shutdown sequence:

```text
stop accepting HTTP requests
  -> close PostgreSQL pool
  -> gracefully close Redis client
  -> force Redis disconnect only when necessary
  -> complete NestJS shutdown
```

Client cleanup must be idempotent. Shutdown errors are logged safely and do not expose connection configuration.

## Environment boundary

Extend the existing API environment schema and service with:

```ts
readinessTimeoutMs: number
```

Update:

- environment schema;
- schema unit tests;
- `EnvironmentService` getter;
- API `.env.example`;
- root/local-development documentation where API environment values are listed.

`DATABASE_URL` and `REDIS_URL` remain required syntactically at bootstrap, but their targets do not have to be reachable.

This change does not claim completion of the separate repository-wide environment-validation and secret-convention backlog item.

## Dependency additions

Add API runtime dependencies for:

```text
pg
ioredis
```

Add only the required TypeScript development types for the selected versions. Reuse the repository catalog or exact-version conventions where applicable, update the lockfile, and preserve frozen-install compatibility.

Do not introduce an ORM, `@nestjs/terminus`, `nestjs-pino`, or a second logging package.

## Detailed testing strategy

### Request-ID unit tests

- Preserve a valid upstream ID.
- Accept all allowed punctuation and boundary length `128`.
- Replace missing, empty, oversized, whitespace-containing, control-character, Unicode, and multi-value-invalid inputs.
- Use the injected/generated UUID result when replacement is needed.
- Attach the final ID to the request.
- Set the same response header.
- Never echo the rejected value.

### Route and completion-log unit tests

- Resolve a route template including the configured prefix.
- Fall back to a pathname without query values.
- Emit exactly one `http.request_completed` event.
- Include request ID, method, route, status, and duration.
- Use `info` below `500` and `warn` at `500` or above.
- Suppress only successful health and readiness responses.
- Log readiness `503` responses.
- Avoid duplicate events when response hooks are invoked defensively.

### Exception-filter unit tests

- Normalize string and safe object-form `4xx` `HttpException` payloads.
- Preserve safe message arrays used by validation errors.
- Ignore unexpected additional object fields.
- Normalize unknown exceptions to `500`.
- Hide every `5xx` message behind the fixed public message.
- Match response-body request ID to the response header.
- Emit one `http.request_failed` event with the original exception.
- Never include request body, raw query, authorization, cookies, or environment values.

### Probe unit tests

For PostgreSQL:

- successful `SELECT 1` maps to `ok`;
- query rejection maps to a safe failure reason;
- latency is measured;
- pool is reused;
- shutdown closes the pool once.

For Redis:

- `PONG` maps to `ok`;
- an unexpected reply maps to `unexpected_response`;
- connection rejection maps to `connection_failed`;
- latency is measured;
- client is reused;
- shutdown prefers `quit()` and safely falls back to `disconnect()`.

No unit test opens a real PostgreSQL or Redis connection.

### Coordinator unit tests

- Run both probes concurrently.
- Return `200` semantics only when both are `ok`.
- Return `503` semantics when either or both are unavailable.
- Preserve the successful dependency result when the other fails.
- Map deadline expiry to `timeout`.
- Use one independent timeout for each probe.
- Return a cached successful result within one second.
- Return a cached unavailable result within one second.
- Refresh after expiry.
- Deduplicate simultaneous requests into one pair of probes.
- Clear `inFlight` after success and failure.
- Emit failure logs only when an actual probe runs.

Use injected clocks and timers where practical so tests remain deterministic and fast.

### API e2e tests

Build the NestJS application with probe providers overridden by test doubles. Do not require Docker services for deterministic e2e coverage.

Required cases:

- `/api/health` returns `200` and the liveness contract.
- `/api/ready` returns `200` when both probes succeed.
- `/api/ready` returns `503` with dependency statuses when one probe fails.
- Every response has `x-request-id`.
- A valid upstream request ID is propagated.
- An invalid upstream request ID is replaced.
- A controller error returns the normalized envelope.
- Error body and response header contain the same request ID.
- Successful health endpoints do not emit completion logs.
- Readiness `503` emits completion and probe-failure logs.

The standard API `test` command must include deterministic unit and e2e suites so root `pnpm test` and CI enforce them. Real-infrastructure behavior remains in runtime smoke verification.

## Runtime smoke verification

Run PostgreSQL, Redis, and the API with known non-production test credentials.

Verify:

1. `/api/health` returns `200`.
2. `/api/ready` returns `200` with both dependencies `ok`.
3. A supplied valid `x-request-id` is returned unchanged.
4. Stopping Redis causes `/api/ready` to return `503` within the bounded cache/timeout window.
5. PostgreSQL remains reported as `ok` while Redis is unavailable.
6. Restarting Redis allows `/api/ready` to recover to `200` without restarting the API.
7. Successful health checks do not create `http.request_completed` events.
8. Failed readiness creates `readiness.probe_failed` and `http.request_completed` events.
9. An intentional unhandled API error produces `http.request_failed`, a normalized body, and matching request IDs.
10. Logs do not contain the known database URL, Redis URL, usernames, passwords, authorization values, or cookies.
11. Graceful API shutdown closes both dependency clients without an unhandled rejection.

The runtime smoke check is required before completion but does not become a permanent external-service CI job in this scope. A temporary verification workflow may be used and removed before the final tree, as long as the run and commit are recorded in the pull request.

## Documentation and backlog updates

Update the README with:

- liveness and readiness endpoint semantics;
- default public paths under `API_PREFIX=api`;
- `x-request-id` propagation rules;
- normalized API error shape;
- structured event names and safe logged fields;
- `READINESS_TIMEOUT_MS` configuration;
- local commands for dependency and API smoke verification.

Update `docs/backlog/SPRINT-0.md` only after all verification passes:

```text
[x] Health, readiness, requestId và structured logging.
```

Do not mark these separate items complete:

```text
[ ] Environment validation và secret conventions.
[ ] Custom-domain local routing smoke test.
[ ] OpenAPI contract package.
[ ] Tenant context interface.
[ ] Playwright smoke test across storefront, console and API.
```

## Verification commands

At minimum, run from a clean checkout:

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

Also run the API runtime smoke sequence against Docker PostgreSQL and Redis.

Security verification must include the repository dependency audit and secret scan already enforced by unified CI.

## Completion criteria

The change is complete when:

- every HTTP response carries a safe `x-request-id`;
- valid upstream request IDs are preserved and invalid values are replaced;
- normalized errors contain the same request ID as the response header;
- ordinary HTTP requests emit one structured completion event;
- unhandled failures emit a structured failure event and a completion event;
- successful liveness and readiness requests are excluded from completion logs;
- liveness remains `200` during dependency outages;
- readiness runs real `SELECT 1` and `PING` probes and returns `503` when either fails;
- readiness results are cached for one second and concurrent requests are deduplicated;
- PostgreSQL and Redis clients recover without an API restart;
- clients close safely during shutdown;
- unit, deterministic API e2e, clean-build, runtime-smoke, Genesis, Docker configuration, security, and unified CI checks pass;
- documentation reflects the delivered behavior;
- the Sprint 0 backlog item is marked complete;
- no temporary verification workflow remains in the final tree;
- no connection URL, credential, authorization value, cookie, request body, or raw query value appears in logs.
