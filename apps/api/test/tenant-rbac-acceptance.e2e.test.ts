import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, repoRoot), "utf8");
}

async function expectEvidence(path: string, patterns: readonly RegExp[]): Promise<void> {
  const contents = await source(path);
  for (const pattern of patterns) {
    assert.match(contents, pattern, `missing evidence in ${path}: ${pattern}`);
  }
}

test("S2-RBAC01 owner create/read is exercised through the tenant RBAC HTTP API", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-api.e2e.test.ts", [
    /owner can create, read, update, replace permissions, and archive a tenant custom role/u,
    /\.post\("\/api\/tenant\/rbac\/roles"\)/u,
    /\.get\(`\/api\/tenant\/rbac\/roles\/\$\{created\.id\}`\)/u,
  ]);
});

test("S2-RBAC02 normalized-name uniqueness is tenant-scoped", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-schema.integration.test.ts", [
    /active normalized custom-role names are unique only within one tenant/u,
    /tenantAId/u,
    /tenantBId/u,
    /normalizedName/u,
  ]);
});

test("S2-RBAC03 tenant admin is read-only for RBAC", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-api.e2e.test.ts", [
    /tenant admin can read tenant RBAC state but cannot mutate roles or assignments/u,
    /adminSessionCookie/u,
    /\.expect\(403\)/u,
  ]);
});

test("S2-RBAC04 tenant RBAC role APIs remain custom-role-only and fail closed for inaccessible IDs", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-api.e2e.test.ts", [
    /tenant RBAC role IDs reject invalid UUIDs and hide inaccessible resources/u,
    /TENANT_CUSTOM_ROLE_NOT_FOUND/u,
  ]);
  await expectEvidence(
    "apps/api/src/modules/authorization/infrastructure/persistence/prisma/prisma-tenant-custom-role-repository.adapter.ts",
    [/tenant_custom_roles/u, /tenantId/u],
  );
});

test("S2-RBAC05 invalid, platform, and non-delegable permission additions fail atomically", async () => {
  await expectEvidence(
    "apps/api/src/modules/authorization/application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.test.ts",
    [
      /invalid added permissions fail atomically with stable grant-boundary errors/u,
      /TENANT_RBAC_PERMISSION_UNKNOWN/u,
      /TENANT_RBAC_PERMISSION_SCOPE_INVALID/u,
      /TENANT_RBAC_PERMISSION_NOT_DELEGABLE/u,
      /assert\.deepEqual\(events, \[`role\.lock:/u,
    ],
  );
});

test("S2-RBAC06 actor cannot grant a delegable permission they do not hold", async () => {
  await expectEvidence(
    "apps/api/src/modules/authorization/application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.test.ts",
    [/TENANT_RBAC_PERMISSION_GRANT_NOT_ALLOWED/u, /tenantSecuritySessionRead/u],
  );
});

test("S2-RBAC07 permission replacement bumps role and active holders exactly once", async () => {
  await expectEvidence(
    "apps/api/src/modules/authorization/application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.test.ts",
    [
      /changed permission set replaces mappings, bumps role once, and invalidates active holders in UUID order/u,
      /membership\.bump/u,
      /tenant\.rbac\.role\.permissions_changed/u,
    ],
  );
});

test("S2-RBAC08 stale or concurrent expectedVersion cannot partially commit authority", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-role-concurrency.e2e.test.ts", [
    /S2-RBAC08 concurrent permission replacements with one expectedVersion commit authority at most once/u,
    /TenantCustomRoleVersionConflictError/u,
    /holderAuthorizationVersion/u,
  ]);
});

test("S2-RBAC09 assignment targets same-tenant active membership and invalidates authority once", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-schema.integration.test.ts", [
    /custom-role assignments require same-tenant active membership and role with one active row/u,
  ]);
  await expectEvidence("apps/api/test/tenant-rbac-assignment-concurrency.e2e.test.ts", [
    /S2-RBAC09 concurrent duplicate grants converge to one active assignment and one authority invalidation/u,
    /targetAuthorizationVersion, 2/u,
  ]);
});

test("S2-RBAC10 duplicate grant and revoke races converge without duplicate invalidation", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-assignment-concurrency.e2e.test.ts", [
    /concurrent duplicate grants converge to one active assignment and one authority invalidation/u,
    /S2-RBAC10 concurrent duplicate revokes converge to one revoke and one authority invalidation/u,
    /grantedAuditCount/u,
    /revokedAuditCount/u,
  ]);
});

test("S2-RBAC11 archive revokes assignments, invalidates active holders, and blocks invalid races", async () => {
  await expectEvidence(
    "apps/api/src/modules/authorization/application/use-cases/tenant-rbac/archive-tenant-custom-role.use-case.test.ts",
    [
      /archive revokes active assignments, bumps role once, and invalidates only active memberships in UUID order/u,
      /assignments\.revoke/u,
      /tenant\.rbac\.role\.archived/u,
    ],
  );
  await expectEvidence("apps/api/test/tenant-rbac-role-concurrency.e2e.test.ts", [
    /archive racing assignment grant cannot leave an active assignment on the archived role/u,
  ]);
});

test("S2-RBAC12 FORCE RLS denies foreign and missing tenant context", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-rls.integration.test.ts", [
    /all tenant custom RBAC tables use the canonical FORCE-RLS tenant contract/u,
    /foreign and missing tenant context deny CRUD across all custom-RBAC tables/u,
    /app\\\.tenant_id/u,
  ]);
});

test("S2-RBAC13 custom roles contribute effective permissions without widening roleKeys", async () => {
  await expectEvidence("apps/api/test/tenant-rbac-authoritative-context.e2e.test.ts", [
    /S2-RBAC13 authoritative context includes only active custom-role permission contributions/u,
    /active\.roleKeys/u,
    /active\.permissionKeys/u,
    /archived\.permissionKeys/u,
  ]);
});

test("S2-RBAC14 stale custom-role authority is rejected before protected application work", async () => {
  await expectEvidence("apps/api/test/authorization-context-concurrency.e2e.test.ts", [
    /S2-RBAC14 custom-role revoke invalidates stale permission before protected membership read/u,
    /TenantAuthorizationStaleError/u,
    /membershipAuthorizationVersion, 11/u,
  ]);
});

test("S2-RBAC15 RBAC authority mutations emit bounded transactional audit evidence", async () => {
  await expectEvidence(
    "apps/api/src/modules/authorization/application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.test.ts",
    [
      /audit:tenant\.rbac\.role\.permissions_changed/u,
      /addedPermissionKeys/u,
      /removedPermissionKeys/u,
    ],
  );
  await expectEvidence("apps/api/src/common/security/security-audit-events.test.ts", [
    /tenant\.rbac\.role\.created/u,
    /tenant\.rbac\.assignment\.revoked/u,
  ]);
});

test("S2-RBAC16 Sprint 1B and protected repository gates remain explicit prerequisites", async () => {
  await expectEvidence("scripts/identity-access-gate.test.mjs", [
    /verify:identity-access/u,
    /Identity access acceptance/u,
  ]);
  await expectEvidence(".github/workflows/ci.yml", [
    /name: Identity access acceptance/u,
    /name: Build/u,
    /name: Playwright foundation smoke/u,
    /name: Production configuration guard/u,
    /name: Security/u,
  ]);
});
