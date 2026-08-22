# Sprint 2 Tenant Dynamic RBAC Closeout Checkpoint

Date: 2026-08-20

Status: IMPLEMENTED — FINAL CLOSEOUT VERIFICATION PENDING.

## Scope

Sprint 2 extends the Sprint 1B Platform/Tenant authorization kernel with tenant-scoped custom roles, role-permission mappings, membership role assignments, optimistic versioning, authority invalidation, concurrency controls, transactional audit, FORCE-RLS persistence, normative HTTP APIs, and dedicated `S2-RBAC01`–`S2-RBAC16` acceptance verification.

Canonical scope:

- `docs/superpowers/specs/2026-08-16-sprint-2-tenant-dynamic-rbac-design.md`
- `docs/superpowers/plans/2026-08-16-sprint-2-tenant-dynamic-rbac.md`

Full Role Builder UI, platform custom roles, partner roles, and custom-role invitation redesign remain outside this closeout.

## Task 9 verified implementation baseline

Task 9 was freshly verified before knowledge closeout on implementation head `ba50f33a5f265077362d3dbb08a768d41c0cca87`:

- CI #2003: SUCCESS — Quality, OpenAPI compatibility, Docker configuration, Unit/API E2E/RLS, migration verification, Sprint 1B identity access, Sprint 2 dynamic RBAC acceptance, build, Playwright foundation smoke, production configuration, dependency audit, and committed-secret scan.
- Sprint 0 gates #1558: SUCCESS.
- API architecture boundaries #1492: SUCCESS.
- Identity email integration #1271: SUCCESS.

The dedicated protected command is `pnpm verify:dynamic-rbac` and resolves `S2-RBAC01` through `S2-RBAC16` to concrete executable evidence.

## Task 10 documentation TDD evidence

1. RED expectations commit `59d6792f382aba1d4fa8d9b6ae668244c55b59bb` added Sprint 2 closeout knowledge tests before validator/docs implementation.
2. Sprint 0 #1559 produced the expected RED: existing Genesis tests passed and only the two new Sprint 2 closeout tests failed because repository validation did not yet enforce Sprint 2 artifacts/references/recovery/owner/delivery markers.
3. Validator commit `be2171a1b965c3c47ba1ae017d874855b18e7722` added the minimal Sprint 2 closeout validation contract while reusing existing reference, owner, and secret-safe runbook rules.
4. Sprint 0 #1560 moved all 15 Genesis tooling tests GREEN, then produced the expected repository-validation RED for exactly six unresolved knowledge items: the feature, pattern, recovery runbook, checkpoint, 90-day delivery marker, and Pilot gate marker.
5. This knowledge implementation adds those six items without introducing a new deployment unit or bounded-domain owner.

Final closeout SHA and same-head protected workflow run numbers will be recorded after fresh verification of the knowledge implementation and reconciliation commit.

## Acceptance evidence map

- `S2-RBAC01` owner create/read — HTTP/use-case acceptance.
- `S2-RBAC02` normalized-name tenant isolation — schema/repository acceptance.
- `S2-RBAC03` tenant-admin read-only — grant-policy/controller acceptance.
- `S2-RBAC04` system-role immutability — SQL repository evidence plus HTTP mutation boundaries.
- `S2-RBAC05` invalid/non-delegable permission rejection — grant-policy/use-case acceptance.
- `S2-RBAC06` actor cannot grant more authority than held — owner grant-policy acceptance.
- `S2-RBAC07` permission replacement versions — PostgreSQL/use-case acceptance.
- `S2-RBAC08` stale `expectedVersion` atomic rejection — concurrency/version acceptance.
- `S2-RBAC09` same-tenant active membership assignment — assignment acceptance.
- `S2-RBAC10` duplicate grant/revoke concurrency — PostgreSQL concurrency acceptance.
- `S2-RBAC11` archive consequences — archive and assignment concurrency acceptance.
- `S2-RBAC12` FORCE RLS/missing tenant context — RLS integration acceptance.
- `S2-RBAC13` permission-only custom authority — authoritative-context PostgreSQL acceptance.
- `S2-RBAC14` stale-session reconciliation before use case — authorization-context concurrency acceptance.
- `S2-RBAC15` transactional bounded secret-safe audit — use-case/security-audit acceptance.
- `S2-RBAC16` Sprint 1B and protected-gate regression — dedicated verifier/protected CI chain.

## Operational artifacts

- `docs/features/FEATURE-0003-tenant-dynamic-rbac.md`
- `docs/patterns/PATTERN-0004-tenant-dynamic-rbac-authority.md`
- `docs/runbooks/tenant-dynamic-rbac-recovery.md`
- `docs/ownership/DOMAIN-OWNERS.md`
- `docs/plan/90-DAY-EXECUTION.md`
- `genesis/reviews/PILOT-GATES.md`

Architecture/module placement is unchanged: Authorization remains inside the existing API deployment unit and Tenancy remains the transaction/RLS boundary. Therefore Task 10 does not create a new deployment unit or bounded-domain label.

## Rollout and recovery posture

Sprint 2 schema is additive. Roll out compatible database/catalog changes before enabling application mutations, keep FORCE RLS and authorization-version reconciliation blocking, and use reviewed owner-governed HTTP mutations for operational corrections. During a mutation incident, mutation routes may be disabled by a reviewed application deployment/routing change while RBAC persistence/history and read authorization remain intact. Never delete RBAC history as rollback.

## Review handoff

PR #32 remains Draft. No external reviewer approval is recorded by this checkpoint, and no reviewer is fabricated or self-requested. Do not mark ready, merge, or change the review boundary without explicit instruction.
