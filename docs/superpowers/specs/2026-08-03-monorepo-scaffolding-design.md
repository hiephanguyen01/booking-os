# Monorepo Scaffolding Design

## Status

Approved design; pending written-spec review and implementation planning.

## Context

The repository already has a pnpm workspace, Turborepo, a NestJS API, the `@booking-os/contracts` package, shared TypeScript configuration, Docker Compose infrastructure, and unified CI.

The architecture baseline defines six deployment units:

- `web-storefront`: Next.js public storefront.
- `web-console`: Next.js console.
- `api`: NestJS modular monolith.
- `worker-critical`: critical payment, booking, refund, settlement, and payout jobs.
- `worker-batch`: notification, report, indexing, and maintenance jobs.

Only `apps/api` currently exists. Sprint 0 also requires shared packages for API access, UI, internationalization, authentication, observability, and testing.

This design completes the runnable monorepo skeleton without implementing product features, production authentication, domain job handlers, or deployment.

## Goals

- Add runnable shells for `web-storefront`, `web-console`, `worker-critical`, and `worker-batch`.
- Add minimal usable APIs for `api-client`, `ui`, `i18n`, `auth`, `observability`, and `testing`.
- Prove workspace wiring by importing every new shared package from at least one real consumer.
- Keep shared packages deterministic and independent from deployment-unit environment variables.
- Ensure clean-checkout formatting, lint, typecheck, unit test, and production build commands pass across the complete workspace.
- Preserve the existing architectural constraint that browsers do not hold access tokens and Next.js acts as the future BFF boundary.

## Non-goals

- Real login, cookie storage, middleware, or session persistence.
- OpenAPI generation.
- Locale-aware routing or `next-intl` integration.
- Product pages, admin workflows, or a complete design system.
- Real payment, booking, refund, notification, reporting, indexing, or maintenance handlers.
- PostgreSQL or Redis integration tests.
- OpenTelemetry exporters, tracing, or metrics.
- Request-ID middleware for the API.
- Playwright coverage.
- Docker images or Compose services for the new applications.
- Global environment-validation and secret-convention completion.
- Deployment or release automation.

## Selected approach

Use a vertical runnable skeleton. Applications and packages are added together, and each package has a real consumer in the same change.

This avoids temporary app-local abstractions and verifies the dependency graph, package exports, clean builds, and runtime boundaries immediately.

## Workspace layout

```text
apps/
  api/
  web-storefront/
  web-console/
  worker-critical/
  worker-batch/
packages/
  api-client/
  auth/
  contracts/
  i18n/
  observability/
  testing/
  typescript-config/
  ui/
```

The existing workspace globs already include `apps/*` and `packages/*`; no new workspace root is required.

## Dependency rules

The allowed direction is:

```text
applications -> shared packages -> contracts/typescript-config
```

Rules:

- Applications may import shared packages.
- Shared packages must not import applications.
- Production packages must not depend on `@booking-os/testing`.
- `@booking-os/testing` is a development-only dependency of tests.
- Shared packages must not read `process.env`, connect to Redis, access a database, or depend on a Next.js runtime.
- Queue connections and worker lifecycle stay inside worker deployment units.
- `@booking-os/ui` may depend on React but not Next.js.
- Framework-specific adapters remain in their deployment unit unless repeated usage later justifies a dedicated package.

## Package conventions

All new packages are private ESM workspace packages and use the existing strict TypeScript baseline.

Framework-independent packages (`api-client`, `auth`, `i18n`, `observability`, and `testing`) compile JavaScript and declarations to `dist` and expose explicit package exports. A package's own tests may execute its source through the repository test runner. Other workspaces consume the compiled export contract; Turborepo builds upstream packages first.

`@booking-os/ui` is an internal React source package because Next.js must process its TSX and CSS Modules. Its export map points runtime imports to source and type imports to generated declarations. Each Next.js app lists it in `transpilePackages`. Its unit-test runner must support React rendering and CSS Module imports.

Every package provides the standard scripts applicable to it:

```text
build
lint
typecheck
test
clean
```

No package publishes to a registry in this scope.

## Web applications

### Technology and structure

Both web applications use Next.js App Router, React, TypeScript, and server components by default.

Each application contains:

```text
app/
  layout.tsx
  page.tsx
  globals.css
src/
  service-status.ts
next.config.ts
package.json
tsconfig.json
```

The initial pages are operational shells rather than product UI. Pure mapping and configuration logic stays outside the page module so it can be unit tested without starting Next.js.

### Shared package usage

Both applications consume:

- `@booking-os/api-client`
- `@booking-os/i18n`
- `@booking-os/ui`

`web-console` additionally consumes `@booking-os/auth`.

### Storefront shell

The storefront page displays:

- the localized application name and shell description;
- a shared status card from `@booking-os/ui`;
- the current API health state;
- a clear degraded state when the API cannot be reached.

### Console shell

The console page displays:

- the localized console name and shell description;
- a shared status card;
- API health state;
- a sample authenticated session built from shared auth types;
- the sample role and the result of a permission check.

The sample session is demonstration data only. It is not read from a cookie and does not represent a login flow.

### API health flow

The server-side flow is:

```text
Next.js page
  -> createApiClient({ baseUrl })
  -> GET /health relative to API_BASE_URL
  -> validate response shape
  -> return HealthResponse from @booking-os/contracts
  -> map to healthy or degraded UI state
```

The default local value is:

```text
API_BASE_URL=http://localhost:3001/api
```

The package receives `baseUrl`; it never reads the environment itself.

The initial pages are explicitly dynamic so `next build` does not make a live API request. Health is fetched at request time with a bounded timeout.

### Web failure behavior

`@booking-os/api-client` distinguishes:

- invalid client configuration;
- network or timeout failures;
- non-success HTTP responses;
- invalid JSON or contract shape.

The client exposes typed errors. Pages catch those errors and render a degraded state instead of failing the entire request.

The scaffold does not retry automatically.

## Worker applications

### Runtime model

Both workers use a NestJS standalone application context with direct BullMQ providers. They do not create an HTTP server.

Each worker contains:

- a bootstrap entry point;
- an application module;
- a configuration boundary;
- a BullMQ connection provider;
- one queue worker provider;
- a typed sample processor;
- shutdown lifecycle handling;
- a local smoke producer for the scaffold job.

Queue names are fixed in the deployment unit:

```text
worker-critical -> booking-critical
worker-batch    -> booking-batch
```

### Sample job

Each worker accepts a scaffold-only `health-check` job.

The payload is validated before processing and includes a correlation identifier. A valid job returns a small acknowledgement containing the service and job identity. Invalid payloads fail with a typed validation error.

No domain queue names or handlers are added yet.

Each worker exposes a `smoke:enqueue` script that adds one valid `health-check` job to its queue. The producer is a local verification aid, not a long-running deployment unit.

### Redis configuration

Each worker reads and validates only its own runtime configuration:

```text
NODE_ENV
REDIS_HOST
REDIS_PORT
REDIS_USERNAME
REDIS_PASSWORD
```

Defaults may be provided for local host and port. Username and password are optional. Passwords and connection strings must never appear in logs.

This local validation is limited to worker bootstrap requirements and does not complete the separate repository-wide environment-validation backlog item.

### Startup and shutdown

Startup order:

```text
load and validate config
  -> create Nest application context
  -> create Redis connection
  -> create BullMQ worker
  -> log service-ready event
```

Shutdown order:

```text
stop accepting jobs
  -> close BullMQ worker
  -> close Redis connection
  -> close Nest application context
```

`SIGINT` and `SIGTERM` trigger graceful shutdown. Bootstrap failure or a fatal Redis/runtime connection failure sets a non-zero process exit code.

A normal job-handler error, including invalid job input, fails that BullMQ job and is logged; it does not terminate the worker process.

Worker unit tests instantiate processors and lifecycle units with test doubles; they do not connect to Redis.

## Shared packages

### `@booking-os/api-client`

Provides a small typed fetch client:

```ts
createApiClient({
  baseUrl,
  fetchImplementation?,
  timeoutMs?,
})
```

Initial public operation:

```ts
client.health.get(): Promise<HealthResponse>
```

The client uses the existing `HealthResponse` type from `@booking-os/contracts`. Because that package currently exposes types rather than a runtime schema, `api-client` owns a narrow runtime schema for the health response and verifies at compile time that its parsed result is assignable to `HealthResponse`. This avoids silently trusting network JSON without expanding the contract package into the separate OpenAPI work.

Injectable `fetchImplementation` keeps tests deterministic.

OpenAPI generation is deferred to the separate P1 contract-package work.

### `@booking-os/ui`

Provides a small React component surface beginning with a status card suitable for both web shells.

The component supports a constrained state such as `healthy`, `degraded`, or `neutral`, renders accessible text, and uses CSS Modules. It contains no Next.js imports, routing assumptions, or product-specific business logic.

This package is a seed for shared UI, not a complete design system.

### `@booking-os/i18n`

Provides:

- `Locale` typed as `vi | en`;
- typed message keys;
- dictionaries for Vietnamese and English;
- locale normalization;
- fallback to Vietnamese;
- a message lookup helper.

Missing or unsupported locale input falls back to `vi`. Missing message keys are prevented by the typed dictionary shape rather than silently accepted at runtime.

Locale routing and middleware are outside scope.

### `@booking-os/auth`

Provides framework-independent authorization primitives:

- shared session and user types;
- role constants;
- permission constants;
- role-to-permission mapping;
- `hasPermission` and related helpers.

The initial role set supports the known console audiences: Platform, Tenant, Partner, and Affiliate. The package does not issue tokens, read cookies, store sessions, or call the API.

### `@booking-os/observability`

Provides a small structured JSON logger and context types.

Supported context fields begin with:

```text
requestId
jobId
jobName
tenantId
service
```

The logger:

- writes one JSON object per event;
- adds an ISO-8601 timestamp and level;
- merges bound and event context;
- excludes fields whose value is `undefined`;
- serializes `Error` objects safely;
- accepts an injectable sink for tests.

The workers use it for startup, job, error, and shutdown events. The API uses it for a minimal bootstrap event only; full HTTP request logging and request-ID propagation remain in the separate runtime-observability backlog item.

### `@booking-os/testing`

Provides reusable immutable fixture factories and assertion helpers for:

- health responses;
- sessions and users;
- worker health-check jobs;
- structured log records or test context.

Each factory returns fresh data so one test cannot mutate another test's fixture. The package does not start external services.

It is consumed only from test code.

## Runtime data flows

### Web health rendering

```text
request page
  -> resolve locale
  -> create API client from app config
  -> fetch and validate health response
  -> map response/error to service status
  -> render shared localized status card
```

### Worker job processing

```text
BullMQ receives health-check job
  -> validate payload
  -> bind job logging context
  -> log job.started
  -> process acknowledgement
  -> log job.completed
```

Invalid payloads produce `job.failed` logging and a failed BullMQ job while the worker continues processing later jobs.

## Logging contract

A representative record is:

```json
{
  "level": "info",
  "message": "job.completed",
  "service": "worker-critical",
  "jobId": "123",
  "jobName": "health-check",
  "timestamp": "2026-08-03T12:00:00.000Z"
}
```

Optional fields are omitted rather than written as `null` or `undefined`. Secret values are never included.

## Testing strategy

### Shared package tests

- `api-client`: success, non-success HTTP response, invalid payload, invalid URL, and network/timeout failure.
- `auth`: role mapping, allowed permission, denied permission, and session fixture usage.
- `i18n`: Vietnamese, English, unsupported-locale fallback, and typed dictionary completeness.
- `observability`: JSON output, context merge, error serialization, and removal of undefined fields.
- `ui`: render the component with content and representative states; verify accessible output while processing CSS Modules.
- `testing`: fixture freshness and assertion-helper behavior.

### Web application tests

Each web app tests its pure service-status mapping and local configuration defaults without starting Next.js or making network requests. Shared component rendering remains covered by `@booking-os/ui`.

### Worker tests

- valid `health-check` payload returns the expected acknowledgement;
- invalid payload raises the expected validation error;
- lifecycle shutdown closes resources in order using test doubles;
- logging receives the expected job context.

No worker unit test opens a Redis connection.

### Application verification

Both Next.js applications must:

- pass strict typecheck;
- pass their pure unit tests;
- build production output;
- resolve all workspace imports from a clean checkout;
- avoid live API calls during build;
- render degraded status for API-client failures.

Both workers must:

- pass strict typecheck and unit tests;
- compile to `dist`;
- bootstrap as Nest standalone contexts;
- expose testable processors independent of Redis;
- install graceful shutdown handling.

## Turborepo and CI

No new CI job is required. The existing root commands discover all new workspaces:

```bash
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The current Turborepo graph already builds upstream dependencies before consumer typecheck and tests. New package scripts and outputs must align with that graph.

The lockfile must be updated, and `pnpm install --frozen-lockfile` must succeed from a clean checkout.

The implementation must not add coverage thresholds, deployment steps, Docker image builds, or Playwright execution.

## Documentation and backlog updates

Update the repository documentation with:

- the final application and package structure;
- local commands for running each web app and worker;
- the local API base URL and Redis configuration examples.

After all verification passes, update Sprint 0:

```text
[x] Khởi tạo pnpm workspace và Turborepo.
[x] Tạo apps: api, web-storefront, web-console, worker-critical, worker-batch.
[x] Tạo packages: contracts, api-client, ui, i18n, auth, observability, testing.
[x] Docker Compose: PostgreSQL, Redis, MinIO và Mailpit.
```

The Docker Compose item is marked complete only after its existing configuration command is re-run successfully.

Do not mark health/readiness/requestId/structured logging, global environment validation, OpenAPI, or Playwright complete in this change.

## Local verification

Run from a clean checkout:

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

Additional runtime smoke checks:

- start the API and confirm its health endpoint responds;
- start each web app and confirm its shell renders healthy or degraded status;
- start Redis and each worker;
- run each worker's `smoke:enqueue` script and confirm the scaffold job completes;
- send `SIGTERM` to each worker and confirm graceful shutdown logs.

Runtime smoke checks are required before declaring the implementation complete but are not added as CI integration tests in this scope.

## Completion criteria

The change is complete when:

- all four new applications run as designed;
- every new shared package has a real consumer;
- all shared packages, web apps, and workers pass their specified unit tests;
- clean-checkout install, formatting, lint, typecheck, test, build, Genesis validation, and Compose validation pass;
- the lockfile and repository documentation match the final implementation;
- only the four explicitly delivered Sprint 0 foundation items are marked complete;
- no out-of-scope authentication, product workflow, OpenAPI generation, telemetry backend, integration-test infrastructure, or deployment behavior is introduced.
