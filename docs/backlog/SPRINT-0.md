# Sprint 0 Backlog

## P0 — Repository and Runtime Foundation

- [x] Khởi tạo pnpm workspace và Turborepo.
- [x] Tạo apps: api, web-storefront, web-console, worker-critical, worker-batch.
- [x] Tạo packages: contracts, api-client, ui, i18n, auth, observability, testing.
- [x] Docker Compose: PostgreSQL, Redis, MinIO và Mailpit.
- [x] CI: format, lint, typecheck, unit, secret/dependency scan và build.
- [x] Health, readiness, requestId và structured logging.
- [x] Environment validation và secret conventions.
- [x] Custom-domain local routing smoke test.

## P0 — Knowledge and Governance

- [ ] Adopt ADR template.
- [ ] Adopt feature template.
- [ ] Adopt pattern template.
- [x] Enable `genesis validate` in CI.
- [ ] Assign owners for Identity, Tenancy, Catalog, Booking, Payment và Finance.
- [ ] Freeze naming of deployment units.
- [ ] Record architecture baseline in ADRs.

## P1 — First Vertical Slice Skeleton

- [ ] OpenAPI contract package.
- [x] Tenant context interface.
- [x] RLS migration proof of concept.
- [x] Session BFF proof of concept.
- [x] Outbox table and relay skeleton.
- [x] Playwright smoke test across storefront, console and API.
