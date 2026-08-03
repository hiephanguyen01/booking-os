# Sprint 0 Backlog

## P0 — Repository and Runtime Foundation

- [ ] Khởi tạo pnpm workspace và Turborepo.
- [ ] Tạo apps: api, web-storefront, web-console, worker-critical, worker-batch.
- [ ] Tạo packages: contracts, api-client, ui, i18n, auth, observability, testing.
- [ ] Docker Compose: PostgreSQL, Redis, MinIO và Mailpit.
- [x] CI: format, lint, typecheck, unit, secret/dependency scan và build.
- [ ] Health, readiness, requestId và structured logging.
- [ ] Environment validation và secret conventions.
- [ ] Custom-domain local routing smoke test.

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
- [ ] Tenant context interface.
- [ ] RLS migration proof of concept.
- [ ] Session BFF proof of concept.
- [ ] Outbox table and relay skeleton.
- [ ] Playwright smoke test across storefront, console and API.
