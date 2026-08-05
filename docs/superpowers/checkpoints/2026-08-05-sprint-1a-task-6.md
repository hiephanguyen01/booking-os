# Sprint 1A Tenant Isolation Core Checkpoint

Date: 2026-08-05
Branch: `feat/sprint-1a-tenant-isolation`
Pull request: `#10`

## Implemented

- Hexagonal API architecture verifier and module manifest
- Trusted request and tenant execution context contracts
- Tenant UUID validation and typed context errors
- Tenant hostname resolution through an application port
- Strict proxy-trust configuration and HTTP tenant adapters
- Technology-neutral tenant transaction capability session
- Prisma transaction adapter owning `booking_app` and transaction-local `app.tenant_id`
- Tenant-probe application use case, inbound controller, module composition, and AppModule cutover
- Removal of the superseded `apps/api/src/tenancy` implementation
- Cross-tenant CRUD, raw SQL, rollback, concurrency, and HTTP resolution test matrix
- Fail-closed PostgreSQL tenant-policy catalog verifier integrated with migration verification
- Fixed-role `WorkerDatabase` boundary for privileged outbox processing
- Application-role and worker-role outbox integration coverage
- Tenant isolation architecture and recovery operating guidance

## Verification evidence available

- Architecture fixtures and repository verification passed on pre-cutover heads.
- Sprint 0 gates passed on pre-cutover heads.
- Local Node.js 22 TDD suites passed for context, tenant resolution, hostname policy, transaction-session behavior, and the tenant-probe use case.
- Task 7 test files passed Node.js syntax checks.
- Task 8 verifier and fixture suite passed strict TypeScript checking with a minimal local `pg` type stub.
- Task 9 worker and integration changes passed Node.js syntax review.
- The complete branch diff was reviewed against `main`; implementation scope matches the approved plan.

## Current verification blocker

Post-cutover GitHub Actions runs fail before checkout. Independent jobs report no steps and no downloadable logs, and dependent test/build jobs are skipped. Re-running produces the same provisioning-level result.

Because no current runner has executed formatting, lint, repository typecheck, database integration tests, migration replay, build, Playwright, security, Genesis, or OpenAPI gates, the feature remains `draft` and pull request #10 remains a draft.

## Required before merge

Run and pass the complete repository gates on a working runner or full local checkout:

```bash
pnpm install --frozen-lockfile
pnpm check:ci
pnpm verify:architecture
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:api
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm verify:migrations
pnpm genesis:validate
pnpm api:check-generated
pnpm api:verify-compatibility-fixtures
pnpm build
pnpm test:e2e
pnpm verify:production-config
pnpm audit --audit-level high
```

Any finding from these gates must be fixed before changing `FEATURE-0001` to `active` or marking the PR ready for review.
