# Sprint 2 Tenant Dynamic RBAC Plan — Self-Review Amendments

Date: 2026-08-16
Status: Approved execution clarifications
Applies to: `2026-08-16-sprint-2-tenant-dynamic-rbac.md`

These amendments resolve ambiguities found during the `writing-plans` self-review. Where this file conflicts with the implementation plan, this file is authoritative.

## 1. HTTP error mapping is exact

Task 8 uses the current NestJS controller conventions already present in tenant membership administration.

Use exactly:

- malformed UUID/path/body shape -> HTTP `400 Bad Request`;
- `TENANT_RBAC_PERMISSION_UNKNOWN` and `TENANT_RBAC_PERMISSION_SCOPE_INVALID` -> HTTP `400 Bad Request`;
- `TENANT_RBAC_PERMISSION_NOT_DELEGABLE`, `TENANT_RBAC_PERMISSION_GRANT_NOT_ALLOWED`, `TENANT_RBAC_ASSIGNMENT_NOT_ALLOWED`, and owner-governance denial -> HTTP `403 Forbidden`;
- inaccessible/missing current-tenant role, membership, or assignment, including foreign-tenant UUIDs -> HTTP `404 Not Found` without existence leakage;
- `TENANT_CUSTOM_ROLE_VERSION_CONFLICT`, active-name conflict, inactive-state conflict, and archive/state conflicts -> HTTP `409 Conflict`;
- unexpected Prisma/SQL/internal errors are not remapped to client-safe domain codes and must remain server errors without raw database detail in the response.

Do not use HTTP 422 for Sprint 2 RBAC unless a later repository-wide API convention explicitly supersedes this amendment.

## 2. TenantDataSession composition is exact

Task 3 extends the existing capability session as:

```ts
export interface TenantDataSession extends MembershipDataSession, TenantRbacDataSession {
  readonly tenantProbes: TenantProbeRepositoryPort;
}
```

`TenantRbacDataSession` exposes these direct transaction-bound capabilities:

```ts
export interface TenantRbacDataSession {
  readonly customRoles: TenantCustomRoleRepositoryPort;
  readonly customRoleAssignments: TenantCustomRoleAssignmentRepositoryPort;
  readonly rbacPermissions: TenantRbacPermissionRepositoryPort;
}
```

Do not add a nested generic repository container and do not expose `Prisma.TransactionClient`.

## 3. Audit type change is minimal

Task 4 must append the six RBAC event literals to `apps/api/src/common/security/security-audit-events.ts`.

Because `TenantSecurityAuditEventType` already extracts `tenant.${string}` from the closed central union, `apps/api/src/modules/memberships/application/ports/tenant-security-audit.port.ts` needs no semantic widening. Modify it only if compilation requires an import/format change; do not widen the type to arbitrary strings.

## 4. Dedicated dynamic-RBAC verifier mirrors the identity-access verifier

Task 9 implements `scripts/verify-dynamic-rbac.mjs` using the same `spawnSync` fail-fast pattern as `scripts/verify-identity-access.mjs`.

It must:

```text
1. pnpm exec turbo run build --filter=@booking-os/api
2. pnpm --filter @booking-os/api prisma:migrate:deploy
3. run Node test with --test-concurrency=1 --import tsx over the Sprint 2 matrix files
```

The minimum matrix is:

```text
test/tenant-rbac-acceptance.e2e.test.ts
test/tenant-rbac-role-concurrency.e2e.test.ts
test/tenant-rbac-assignment-concurrency.e2e.test.ts
test/tenant-rbac-rls.integration.test.ts
```

Set `DYNAMIC_RBAC_MATRIX=1` in the spawned test environment so matrix-only setup can be explicitly guarded when required.

Root script is exactly:

```json
"verify:dynamic-rbac": "node scripts/verify-dynamic-rbac.mjs"
```

## 5. Protected CI wiring is exact

Modify `.github/workflows/ci.yml` by adding a `dynamic-rbac` job after `identity-access` and before `build`.

The job:

- `needs: identity-access`;
- uses PostgreSQL 17 and Redis 7 services, matching the identity-access job pattern;
- uses database `booking_os_dynamic_rbac`;
- sets a test-only `SESSION_SECRET` of at least 32 characters;
- installs dependencies with `pnpm install --frozen-lockfile`;
- runs `pnpm verify:dynamic-rbac`.

Change the `build` job dependency from `needs: identity-access` to `needs: dynamic-rbac`.

Do not weaken or remove the existing identity-access job.

## 6. Security closeout commands are exact

Local dependency audit command:

```bash
pnpm audit --audit-level high
```

Committed-secret scanning is not a pnpm/local repository command. The protected CI security job uses:

```text
gitleaks/gitleaks-action@v2
```

with complete git history. Sprint 2 closeout therefore requires the same-head GitHub Actions `Security` job to complete successfully; do not invent a local gitleaks command as equivalent evidence.

## 7. Self-review outcome

- Spec coverage: all approved Sprint 2 design sections map to Tasks 1–10.
- Placeholder scan: no `TODO` or `TBD` remains in the plan.
- Type consistency: `PermissionKey`, `SystemRole`, `ActiveTenantAuthorizationContext`, `TenantTransactionPort`, `MembershipRepositoryPort`, and the new tenant-RBAC port names are used consistently across task boundaries.
- Scope remains one subsystem: tenant dynamic RBAC foundation. Full Role Builder UI, platform/partner custom roles, and invitation redesign remain deferred.
