# Foundation Recovery Runbook

This runbook covers the Booking OS Pilot foundation only. It assumes PostgreSQL, Redis, the API, web apps, and workers are deployed from the same reviewed commit.

## Safety rules

- Diagnose with health endpoints, structured logs, migration status, architecture verification, tenant-policy verification, and read-only queries first.
- Do not repair booking, payment, finance, tenant, outbox, or session state with ad-hoc SQL.
- Never run reset or restore commands against production.
- Prefer a forward-fix migration over editing an applied migration or `_prisma_migrations`.
- Never disable RLS, remove FORCE RLS, grant `BYPASSRLS` to `booking_app`, or broaden application table grants to bypass an incident.
- Never import an infrastructure adapter directly into domain or application code to bypass a port.
- Record the incident time, environment, commit SHA, request ID, trace ID, effective host, and operator before changing runtime state.

## Readiness failure

1. Separate liveness from dependency readiness:

   ```bash
   curl -sS -i http://127.0.0.1:3001/api/health
   curl -sS -i http://127.0.0.1:3001/api/ready
   ```

2. Inspect service state and correlated logs:

   ```bash
   pnpm infra:ps
   pnpm infra:logs
   ```

3. Decision:
   - `/health` fails: restart or roll back the API process before investigating dependencies.
   - `/health` succeeds and `/ready` fails: identify the failing PostgreSQL or Redis dependency from the readiness payload and continue with the matching section below.
   - both succeed: investigate routing, load balancer, DNS, or the caller rather than restarting dependencies.

## Tenant resolution or isolation failure

1. Capture the response `x-request-id`, `x-trace-id`, request `Host`, and—only when a trusted proxy is configured—the first `x-forwarded-host` value.

2. Correlate the request without logging authorization, cookies, query values, or request bodies:

   ```bash
   pnpm infra:logs | rg 'REQUEST_ID_VALUE|TRACE_ID_VALUE'
   ```

3. Verify the configured host policy:

   ```bash
   rg '^TRUST_PROXY=' apps/api/.env
   ```

   - `TRUST_PROXY=false`: `Host` is authoritative and `x-forwarded-host` must be ignored.
   - `TRUST_PROXY=true`: only the first forwarded host is considered; confirm the request actually arrived through the configured trusted proxy.

4. Run architecture and migration gates against a dedicated non-production database:

   ```bash
   pnpm verify:architecture
   MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
   pnpm --filter @booking-os/api verify:tenant-policies
   ```

5. Inspect the PostgreSQL catalog read-only:

   ```sql
   SELECT
     n.nspname AS schema_name,
     c.relname AS table_name,
     c.relrowsecurity AS rls_enabled,
     c.relforcerowsecurity AS force_rls
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('tenant_probes', 'outbox_events');

   SELECT
     schemaname,
     tablename,
     policyname,
     roles,
     qual,
     with_check
   FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('tenant_probes', 'outbox_events');

   SELECT rolname, rolsuper, rolbypassrls
   FROM pg_roles
   WHERE rolname IN ('booking_app', 'booking_worker');

   SELECT table_name, grantee, privilege_type
   FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('tenant_probes', 'outbox_events')
     AND grantee IN ('booking_app', 'booking_worker')
   ORDER BY table_name, grantee, privilege_type;
   ```

6. Decision:
   - hostname does not resolve to a tenant: correct DNS/proxy routing or tenant configuration; do not accept a tenant ID from body, query, or client headers.
   - `booking_app` is superuser or has `BYPASSRLS`: stop the rollout and restore the reviewed role through a forward migration.
   - RLS, FORCE RLS, tenant index, `USING`, or `WITH CHECK` is missing: stop the rollout and create a reviewed forward migration.
   - architecture verification reports a forbidden import: restore the application port boundary; do not bypass it with a direct Prisma or infrastructure import.
   - a single tenant row appears incorrect: preserve evidence and create a reviewed repair procedure. Do not modify the row ad hoc.

## Redis outage

1. Check Redis and worker logs:

   ```bash
   docker compose --env-file .env.docker ps redis
   docker compose --env-file .env.docker logs redis worker-critical worker-batch
   ```

2. Verify Redis directly:

   ```bash
   docker compose --env-file .env.docker exec redis redis-cli ping
   ```

3. Decision:
   - no `PONG`: restart Redis, then wait for `/api/ready` to return 200.
   - Redis is healthy but workers remain disconnected: restart the affected worker only and verify its `service.ready` event.
   - repeated disconnects: preserve logs and inspect resource limits, credentials, networking, and Redis persistence before another restart.

## Outbox backlog

1. Confirm the critical worker is ready and inspect dispatch errors:

   ```bash
   docker compose --env-file .env.docker logs worker-critical | rg "outbox|worker.fatal|service.ready"
   ```

2. Use a read-only query to measure pending and dead-lettered events:

   ```bash
   docker compose --env-file .env.docker exec postgres psql -U booking -d booking_os -c '
     SELECT
       COUNT(*) FILTER (WHERE dispatched_at IS NULL AND dead_lettered_at IS NULL) AS pending,
       COUNT(*) FILTER (WHERE dead_lettered_at IS NOT NULL) AS dead_lettered,
       MIN(occurred_at) FILTER (WHERE dispatched_at IS NULL) AS oldest_pending
     FROM outbox_events;
   '
   ```

3. Decision:
   - worker unavailable: restore Redis/database connectivity and restart the worker.
   - pending count decreases: keep observing; do not replay manually.
   - pending count is stable or increasing: inspect sanitized `last_error`, queue connectivity, claim timeout, and worker capacity.
   - dead-lettered events exist: create an operational task containing event ID, tenant ID, type, aggregate, attempts, and failure timestamps. Do not modify the row directly.
   - a cross-tenant worker operation is required: use only the reviewed `WorkerDatabase` path with fixed `booking_worker`; never expose a caller-selected role or reuse worker privilege from HTTP code.

## Migration failure or drift

1. Run the automated checks against a dedicated non-production database:

   ```bash
   MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
   pnpm --filter @booking-os/api exec prisma migrate status --schema prisma/schema.prisma
   pnpm --filter @booking-os/api verify:tenant-policies
   ```

2. Decision:
   - migration has not started: correct the migration in the feature branch and rerun verification.
   - migration partially failed: preserve the error and database snapshot, then create a forward-fix migration.
   - migration succeeded but schema differs: stop deployment and create a migration that reconciles the reviewed Prisma schema and database.
   - tenant-policy verification fails: stop deployment; do not disable RLS or broaden role privileges as a workaround.
   - applied migration file changed: restore the committed file; never rewrite production migration history.

A rollback means restoring the previous application version only when that version is compatible with the current schema. Database changes are recovered with a reviewed forward migration.

## Session-store outage

The current foundation proof uses an in-memory opaque-session repository in the console process. A console restart invalidates all active foundation sessions.

1. Confirm the console is running and inspect session-route errors:

   ```bash
   curl -sS -i http://127.0.0.1:3002/api/session
   docker compose --env-file .env.docker logs web-console | rg "session|CSRF|error"
   ```

2. Decision:
   - console unavailable: restart the console and require users to establish a new session.
   - repeated session loss without a restart: stop rollout and investigate process churn or accidental multi-instance use.
   - production persistence is required: do not scale this proof horizontally; implement the planned persistent session store first.

## Restore the development or test database

This operation destroys local development or CI data. Confirm the target is not production before running it.

```bash
pnpm infra:reset
cp .env.docker.example .env.docker
pnpm infra:up
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm --filter @booking-os/api prisma:seed
pnpm verify:migrations
```

After restoration, verify both seeded tenants through the tenant-isolation E2E tests rather than editing rows manually.

## Locate a request by request ID or trace ID

1. Capture `x-request-id` and `x-trace-id` from the response.
2. Record the effective host used for tenant resolution.
3. Search all structured logs:

   ```bash
   pnpm infra:logs | rg 'REQUEST_ID_VALUE|TRACE_ID_VALUE'
   ```

4. Follow the same trace through API, worker, and outbox events. Keep request and trace identifiers in incident notes; do not paste session tokens, secrets, raw provider payloads, or full outbox payloads.

## Foundation verification after recovery

With PostgreSQL and Redis available and the environment configured:

```bash
pnpm verify:architecture
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm verify:foundation
```

The recovery is complete only when formatting, lint, typecheck, unit tests, API/RLS tests, architecture verification, tenant-policy verification, migration verification, build, Playwright smoke, and the production configuration guard all pass.
