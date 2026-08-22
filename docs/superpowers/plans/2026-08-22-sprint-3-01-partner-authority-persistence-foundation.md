# Sprint 3.1 Partner Authority & Persistence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Partner authorization scope, system-role foundation, Partner aggregate persistence, FORCE-RLS boundary, and hexagonal Partner module contracts required by later registration and onboarding slices.

**Architecture:** Extend the existing Platform/Tenant identity-access kernel with a `partner` scope rather than creating a new auth system. Keep PostgreSQL responsible for tenant isolation and structural invariants, while Partner-vs-Partner authorization remains an application resource-policy concern. New Partner code follows `infrastructure -> application -> domain` and consumes existing identity/tenancy contracts only through application-facing ports.

**Tech Stack:** Node.js >=22 <25, pnpm >=10 <11 (`pnpm@10.34.5` in the current baseline), TypeScript 5.9.3, NestJS 11.1.28, Prisma 6.19.3, PostgreSQL 17 FORCE RLS, Node test runner, Supertest, Biome 2.5.6, OpenAPI generation/compatibility tooling.

**Spec:** `docs/superpowers/specs/2026-08-22-sprint-3-partner-foundation-onboarding-design.md`

## Global Constraints

- Do not begin implementation until PR #32 is merged into `main` and the merge head is fresh-green on identity-access, dynamic-RBAC, migration, architecture, API E2E/RLS, build, production-config, dependency-audit, and committed-secret gates.
- At execution time, invoke `superpowers:using-git-worktrees` and create a new isolated Sprint 3 implementation branch from the updated `main`; do not stack production code on the Draft PR #32 branch.
- Carry this approved spec and all Sprint 3 plan files into the implementation branch before Task 1 so executors can read them locally.
- Preserve one global User identity, host-bound opaque sessions, authoritative server-side scope, exact Origin + CSRF protection, and PostgreSQL FORCE RLS.
- Client-supplied `tenantId` and `partnerId` never become authority.
- Permission Catalog V2 remains code-owned and append-only; add only Sprint 3 protected capabilities.
- Partner custom roles and the three-level Role Builder remain out of scope.
- Every Partner-owned table has `tenant_id`; every such table is `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` and appears in the tenant policy manifest.
- Do not add `app.partner_id` RLS context in Sprint 3.
- `booking_app` receives exact minimum DML, not broad CRUD.
- Database triggers protect structural invariants only; lifecycle orchestration/audit remains in application use cases.
- Use TDD for every behavior task: RED test -> prove intended failure -> minimal GREEN -> focused regression -> commit.
- Do not mark any Sprint 3 PR Ready, request/fabricate reviewers, or merge automatically.

---

## File Structure

This plan creates the stable foundation used by Plans 3.2-3.4.

- `packages/auth/src/permissions.ts` — canonical Partner and Tenant-Partner permission keys.
- `packages/auth/src/permission-catalog.ts` — scope/delegability metadata.
- `packages/auth/tests/permission-catalog.test.ts` — catalog closure and delegation tests.
- `packages/contracts/src/auth/authorization-context.ts` — public closed authorization permission/scope contract.
- `packages/contracts/tests/authorization-context.test.ts` — contract closure tests.
- `apps/api/prisma/schema.prisma` — Partner enums/root/membership/system-role assignment/session columns.
- `apps/api/prisma/migrations/<timestamp>_partner_authority_foundation/migration.sql` — additive PostgreSQL schema, RLS, composite FKs, triggers, exact DML, role/permission seed rows.
- `apps/api/prisma/seed.ts` — deterministic local/dev seed parity for system roles and permissions.
- `apps/api/src/modules/partners/domain/partner.ts` — Partner root state/value model.
- `apps/api/src/modules/partners/domain/partner.errors.ts` — stable domain errors.
- `apps/api/src/modules/partners/application/ports/partner-repository.port.ts` — root/membership persistence contract.
- `apps/api/src/modules/partners/application/ports/partner-authorization-query.port.ts` — authoritative Partner authority load contract.
- `apps/api/src/modules/partners/application/ports/partner-data-session.ts` — transaction-bound Partner capability set.
- `apps/api/src/modules/partners/application/ports/partner-transaction.port.ts` — Partner transaction boundary.
- `apps/api/src/modules/partners/infrastructure/persistence/prisma/*` — Prisma adapters.
- `apps/api/src/modules/partners/partners.module.ts` — Partner composition root.
- `apps/api/src/database/prisma-tenant-data-session.factory.ts` — expose Partner session adapters only through the existing tenant transaction context.
- `apps/api/src/modules/tenancy/application/ports/tenant-transaction.port.ts` — compose Partner capabilities into the tenant transaction session without exposing Prisma.
- `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.ts` — exact RLS/DML manifest entries.
- `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-verifier.ts` — only if a new structural verification shape is required.
- `apps/api/test/partner-schema.integration.test.ts` — schema/composite FK/trigger evidence.
- `apps/api/test/partner-rls.integration.test.ts` — FORCE-RLS/missing-context evidence.
- `apps/api/test/partner-minimum-dml.integration.test.ts` — exact privilege evidence.

### Task 1: Extend scope, permission catalog, and immutable Partner system roles

**Files:**
- Modify: `packages/auth/src/permissions.ts`
- Modify: `packages/auth/src/permission-catalog.ts`
- Modify: `packages/auth/tests/permission-catalog.test.ts`
- Modify: `packages/contracts/src/auth/authorization-context.ts`
- Modify: `packages/contracts/tests/authorization-context.test.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/prisma/seed.ts`
- Test: `packages/auth/tests/permission-catalog.test.ts`
- Test: `packages/contracts/tests/authorization-context.test.ts`

**Interfaces:**
- Consumes: existing `PermissionKey`, Permission Catalog V2, closed `AuthorizationPermissionKey`, `IdentityScopeType`, `RoleScopeLevel`.
- Produces: scope value `partner`; immutable system roles `partner_owner`, `partner_admin`; exact Sprint 3 permission keys consumed by Plans 3.2-3.4.

- [ ] **Step 1: Write the RED catalog and contract tests**

Add assertions that the exact new capability set exists and that only the approved tenant-review capabilities are delegable:

```ts
const PARTNER_KEYS = [
  "partner.profile.read",
  "partner.profile.update",
  "partner.application.read",
  "partner.application.submit",
  "partner.verification.read",
  "partner.verification.update",
  "partner.payout_account.read",
  "partner.payout_account.update",
  "partner.review_finding.read",
  "tenant.partner.read",
  "tenant.partner.verification.read",
  "tenant.partner.payout_account.read",
  "tenant.partner.application.review",
  "tenant.partner.application.approve",
  "tenant.partner.application.reject",
  "tenant.partner.lifecycle.suspend",
  "tenant.partner.lifecycle.reactivate",
  "tenant.partner.lifecycle.cancel",
] as const;

assert.equal(getPermissionCatalogEntry("partner.profile.read")?.scopeLevel, "partner");
assert.equal(getPermissionCatalogEntry("tenant.partner.application.review")?.delegable, true);
assert.equal(getPermissionCatalogEntry("tenant.partner.lifecycle.cancel")?.delegable, false);
assert.equal(getPermissionCatalogEntry("tenant.partner.lifecycle.suspend")?.delegable, false);
assert.equal(getPermissionCatalogEntry("tenant.partner.lifecycle.reactivate")?.delegable, false);
```

Also assert the closed authorization contract accepts `scopeType: "partner"` and rejects unknown permission keys.

- [ ] **Step 2: Run focused tests and prove RED**

Run:

```bash
pnpm --filter @booking-os/auth test
pnpm --filter @booking-os/contracts test
```

Expected: FAIL because `partner` scope and the new keys do not yet exist.

- [ ] **Step 3: Append exact permission constants and catalog metadata**

Use lower-case dot-separated identifiers and these scope/delegability rules:

```ts
{
  key: PERMISSION_KEYS.partnerProfileRead,
  scopeLevel: "partner",
  delegable: false,
  description: "Read the current Partner profile.",
},
{
  key: PERMISSION_KEYS.tenantPartnerApplicationReview,
  scopeLevel: "tenant",
  delegable: true,
  description: "Request changes for tenant Partner applications.",
},
{
  key: PERMISSION_KEYS.tenantPartnerLifecycleCancel,
  scopeLevel: "tenant",
  delegable: false,
  description: "Cancel an active or suspended Partner.",
}
```

Extend `PermissionCatalogEntry.scopeLevel` to `"platform" | "tenant" | "partner"` and update `isDelegableTenantPermission()` so only `scopeLevel === "tenant" && delegable` remains delegable.

- [ ] **Step 4: Extend closed authorization scope types**

Keep the public contract explicit:

```ts
export type AuthorizationScopeType = "platform" | "tenant" | "partner";
```

Append all 18 Sprint 3 keys to the existing closed permission-key array; do not add listing/booking/payment keys.

- [ ] **Step 5: Extend Prisma enums and seed only immutable Partner system roles**

In `schema.prisma`:

```prisma
enum IdentityScopeType {
  platform
  tenant
  partner
}

enum RoleScopeLevel {
  platform
  tenant
  partner
}
```

Seed exactly:

```ts
{ key: "partner_owner", scopeLevel: "partner", isSystem: true },
{ key: "partner_admin", scopeLevel: "partner", isSystem: true },
```

Grant `partner_owner` all Partner self-service permissions. Grant `partner_admin` read/profile/application/verification capabilities but do not grant payout-account replacement. Grant tenant review capabilities according to the approved matrix; keep suspend/reactivate/cancel owner-governed initially.

- [ ] **Step 6: Run focused GREEN checks**

```bash
pnpm --filter @booking-os/auth test
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/api prisma:validate
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/auth packages/contracts apps/api/prisma/schema.prisma apps/api/prisma/seed.ts
git commit -m "feat: add partner authorization scope"
```

### Task 2: Add Partner root, membership, system-role assignment, session columns, RLS, and exact DML

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_partner_authority_foundation/migration.sql`
- Modify: `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.ts`
- Test: `apps/api/test/partner-schema.integration.test.ts`
- Test: `apps/api/test/partner-rls.integration.test.ts`
- Test: `apps/api/test/partner-minimum-dml.integration.test.ts`

**Interfaces:**
- Consumes: `tenants(id)`, `tenant_memberships(id, tenant_id)`, immutable `roles`, existing `auth_sessions`, canonical `app.tenant_id`, normal DB role `booking_app`.
- Produces: `partners`, `partner_memberships`, `partner_system_role_assignments`, Partner fields on `auth_sessions`, composite identities required by later plans.

- [ ] **Step 1: Write RED PostgreSQL schema tests**

Assert the exact root shape and same-tenant relationships:

```ts
assert.equal(await hasUniqueConstraint("partners", ["id", "tenant_id"]), true);
assert.equal(
  await hasCompositeForeignKey(
    "partner_memberships",
    ["tenant_membership_id", "tenant_id"],
    "tenant_memberships",
    ["id", "tenant_id"],
  ),
  true,
);
assert.equal(await isForceRls("partners"), true);
assert.equal(await isForceRls("partner_memberships"), true);
assert.equal(await isForceRls("partner_system_role_assignments"), true);
```

Add direct-DML cases proving foreign-tenant membership association, `tenant_id` retargeting, and revoked-membership reactivation are rejected.

- [ ] **Step 2: Run RED database tests**

```bash
pnpm --filter @booking-os/api prisma:generate
node --test --test-concurrency=1 --import tsx apps/api/test/partner-schema.integration.test.ts
```

Expected: FAIL because Partner tables do not exist.

- [ ] **Step 3: Add Prisma models**

Use this conceptual shape, preserving exact tenant columns:

```prisma
enum PartnerType { individual company }
enum PartnerApplicationStatus { draft submitted changesRequested @map("changes_requested") approved rejected }
enum PartnerOperationalStatus { inactive active suspended cancelled }
enum PartnerMembershipStatus { active suspended revoked }

model Partner {
  id                   String                   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId             String                   @db.Uuid @map("tenant_id")
  type                 PartnerType
  applicationStatus    PartnerApplicationStatus @default(draft) @map("application_status")
  operationalStatus    PartnerOperationalStatus @default(inactive) @map("operational_status")
  authorizationVersion Int                      @default(1) @map("authorization_version")
  version              Int                      @default(1)
  submittedAt          DateTime?                @db.Timestamptz(6) @map("submitted_at")
  approvedAt           DateTime?                @db.Timestamptz(6) @map("approved_at")
  suspendedAt          DateTime?                @db.Timestamptz(6) @map("suspended_at")
  cancelledAt          DateTime?                @db.Timestamptz(6) @map("cancelled_at")
  createdAt            DateTime                 @default(now()) @db.Timestamptz(6) @map("created_at")
  updatedAt            DateTime                 @default(now()) @updatedAt @db.Timestamptz(6) @map("updated_at")

  @@unique([id, tenantId])
  @@index([tenantId, applicationStatus])
  @@index([tenantId, operationalStatus])
  @@map("partners")
}
```

`PartnerMembership` must include `tenantId`, `partnerId`, `tenantMembershipId`, `status`, `authorizationVersion`, `revokedAt`, and composite relations to both Partner and TenantMembership. `PartnerSystemRoleAssignment` must link `(partner_membership_id, partner_id, tenant_id)` to the same PartnerMembership and reference only `Role.scopeLevel = partner` through a validation trigger.

Add nullable Partner scope fields to `AuthSession`:

```prisma
partnerId                             String? @db.Uuid @map("partner_id")
partnerAuthorizationVersion           Int?    @map("partner_authorization_version")
partnerMembershipAuthorizationVersion Int?    @map("partner_membership_authorization_version")
```

- [ ] **Step 4: Write the additive SQL migration with composite FKs and structural triggers**

The migration must include:

```sql
ALTER TYPE identity_scope_type ADD VALUE IF NOT EXISTS 'partner';
ALTER TYPE role_scope_level ADD VALUE IF NOT EXISTS 'partner';
```

For every Partner-owned table:

```sql
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;
CREATE POLICY "partners_tenant_isolation" ON "partners"
FOR ALL TO booking_app
USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

Create dedicated triggers that reject identity retargeting and revoked membership reactivation. Use `SECURITY DEFINER SET search_path = public, pg_temp`, revoke function execution from `PUBLIC`, and grant only to `booking_app` where required.

- [ ] **Step 5: Apply exact minimum-DML grants**

Use:

```sql
REVOKE ALL PRIVILEGES ON TABLE "partners" FROM booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "partners" TO booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_memberships" FROM booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "partner_memberships" TO booking_app;
REVOKE ALL PRIVILEGES ON TABLE "partner_system_role_assignments" FROM booking_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "partner_system_role_assignments" TO booking_app;
```

No normal DELETE grant.

- [ ] **Step 6: Add all three tables to the tenant policy manifest**

```ts
{
  table: "partners",
  tenantColumn: "tenant_id",
  tenantColumnNullable: false,
  applicationRole: "booking_app",
  requiredPrivileges: ["INSERT", "SELECT", "UPDATE"],
}
```

Repeat with the exact same privilege set for membership and system-role assignment.

- [ ] **Step 7: Run migration/RLS/DML tests**

```bash
pnpm --filter @booking-os/api prisma:validate
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm verify:migrations
pnpm --filter @booking-os/api test:e2e
```

Expected: Partner schema, cross-tenant, missing-context, trigger, and excess-privilege cases PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add apps/api/prisma apps/api/src/modules/tenancy apps/api/test/partner-*.integration.test.ts
git commit -m "feat: add partner persistence boundary"
```

### Task 3: Implement the Partner domain root and state invariants

**Files:**
- Create: `apps/api/src/modules/partners/domain/partner.ts`
- Create: `apps/api/src/modules/partners/domain/partner.errors.ts`
- Create: `apps/api/src/modules/partners/domain/partner.test.ts`

**Interfaces:**
- Consumes: persisted statuses from Task 2.
- Produces: `PartnerState`, `PartnerType`, `PartnerApplicationStatus`, `PartnerOperationalStatus`, and pure transition guards consumed by Plans 3.3 and 3.4.

- [ ] **Step 1: Write RED domain tests**

```ts
assert.equal(canEditApplication({ applicationStatus: "draft" }), true);
assert.equal(canEditApplication({ applicationStatus: "submitted" }), false);
assert.equal(canCreateInventory({ operationalStatus: "inactive" }), false);
assert.equal(canCreateInventory({ operationalStatus: "active" }), true);
assert.throws(() => assertCanReactivate({ applicationStatus: "rejected", operationalStatus: "suspended" }), PartnerInvalidStateError);
```

- [ ] **Step 2: Run RED test**

```bash
node --test --import tsx apps/api/src/modules/partners/domain/partner.test.ts
```

Expected: FAIL because the Partner domain does not exist.

- [ ] **Step 3: Implement pure domain rules**

```ts
export type PartnerApplicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "approved"
  | "rejected";

export type PartnerOperationalStatus = "inactive" | "active" | "suspended" | "cancelled";

export function canEditApplication(partner: Pick<PartnerState, "applicationStatus">): boolean {
  return partner.applicationStatus === "draft" || partner.applicationStatus === "changes_requested";
}

export function canCreateInventory(partner: Pick<PartnerState, "operationalStatus">): boolean {
  return partner.operationalStatus === "active";
}
```

Implement explicit assertion functions for submit/review/approve/reject/suspend/reactivate/cancel preconditions. Keep them framework-free.

- [ ] **Step 4: Run GREEN unit tests**

```bash
node --test --import tsx apps/api/src/modules/partners/domain/partner.test.ts
pnpm verify:architecture
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/api/src/modules/partners/domain
git commit -m "feat: add partner domain state model"
```

### Task 4: Add Partner application ports, Prisma adapters, tenant transaction wiring, and module composition

**Files:**
- Create: `apps/api/src/modules/partners/application/ports/partner-repository.port.ts`
- Create: `apps/api/src/modules/partners/application/ports/partner-authorization-query.port.ts`
- Create: `apps/api/src/modules/partners/application/ports/partner-data-session.ts`
- Create: `apps/api/src/modules/partners/application/ports/partner-transaction.port.ts`
- Create: `apps/api/src/modules/partners/infrastructure/persistence/prisma/prisma-partner-repository.adapter.ts`
- Create: `apps/api/src/modules/partners/infrastructure/persistence/prisma/prisma-partner-authorization-query.adapter.ts`
- Create: `apps/api/src/modules/partners/infrastructure/persistence/prisma/prisma-partner-adapters.test.ts`
- Create: `apps/api/src/modules/partners/partners.module.ts`
- Modify: `apps/api/src/modules/tenancy/application/ports/tenant-transaction.port.ts`
- Modify: `apps/api/src/database/prisma-tenant-data-session.factory.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 2 tables; canonical tenant transaction setup; Task 3 domain state.
- Produces: framework-free repository/query contracts and transaction-bound Prisma implementations used by all later Partner use cases.

- [ ] **Step 1: Write RED adapter tests for tenant scoping and stable identity**

Use a transaction-bound fixture and assert:

```ts
const partner = await session.partners.findById(partnerId);
assert.equal(partner?.tenantId, tenantA.id);
assert.equal(await session.partners.findById(partnerFromTenantB.id), null);
```

Also assert Partner system-role loading only returns active same-Partner membership assignments and `partner`-scoped role permissions.

- [ ] **Step 2: Define exact application-facing ports**

```ts
export interface PartnerRepositoryPort {
  findById(partnerId: string): Promise<PartnerState | null>;
  findMembership(partnerId: string, tenantMembershipId: string): Promise<PartnerMembershipState | null>;
  lockPartner(partnerId: string): Promise<PartnerState | null>;
  updatePartnerState(input: UpdatePartnerStateInput): Promise<PartnerState>;
}

export interface PartnerAuthorizationSnapshot {
  readonly partnerId: string;
  readonly partnerAuthorizationVersion: number;
  readonly partnerMembershipId: string;
  readonly partnerMembershipAuthorizationVersion: number;
  readonly roleKeys: readonly ("partner_owner" | "partner_admin")[];
  readonly permissions: readonly string[];
}

export interface PartnerAuthorizationQueryPort {
  loadForUser(partnerId: string, userId: string): Promise<PartnerAuthorizationSnapshot | null>;
}
```

- [ ] **Step 3: Extend the transaction session without exposing Prisma**

```ts
export interface PartnerDataSession {
  readonly partners: PartnerRepositoryPort;
  readonly partnerAuthorization: PartnerAuthorizationQueryPort;
}
```

Compose these capabilities into the existing tenant transaction session factory after `SET LOCAL ROLE booking_app` and transaction-local `app.tenant_id` have been established.

- [ ] **Step 4: Implement Prisma adapters with explicit tenant context inherited from the transaction**

Do not accept `tenantId` from controller DTOs. Repositories operate inside the established tenant transaction and query Partner rows by IDs/resource constraints only after RLS context is set.

- [ ] **Step 5: Wire `PartnersModule` and architecture boundaries**

`PartnersModule` owns only its adapters/tokens. It may consume exported application contracts from identity, sessions, membership, authorization, or tenancy modules, but must not import another module's `infrastructure/persistence` directory.

- [ ] **Step 6: Run GREEN adapter/architecture checks**

```bash
pnpm --filter @booking-os/api test
pnpm verify:architecture
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add apps/api/src/modules/partners apps/api/src/modules/tenancy apps/api/src/database apps/api/src/app.module.ts
git commit -m "feat: add partner persistence adapters"
```

### Task 5: Prove the 3.1 foundation is independently green

**Files:**
- Modify only if evidence exposes a real defect in Task 1-4 files.
- Test: all files created above.

**Interfaces:**
- Consumes: Task 1-4.
- Produces: a stable foundation commit that Plan 3.2 can depend on.

- [ ] **Step 1: Run static and package checks**

```bash
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm verify:architecture
```

- [ ] **Step 2: Run Prisma and database checks**

```bash
pnpm --filter @booking-os/api prisma:validate
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm verify:migrations
pnpm --filter @booking-os/api test:e2e
```

- [ ] **Step 3: Run inherited authorization gates**

```bash
pnpm verify:identity-access
pnpm verify:dynamic-rbac
```

- [ ] **Step 4: Run build and generated-contract checks**

```bash
pnpm api:generate
pnpm api:check-generated
pnpm build
```

- [ ] **Step 5: Record the exact GREEN foundation SHA in the execution checkpoint and commit only evidence-driven fixes**

```bash
git status --short
git log -1 --oneline
```

Expected: clean worktree and all commands PASS. Do not begin Plan 3.2 until this gate is green.

## Plan 3.1 Completion Gate

- [ ] `partner` exists in authoritative scope enums/contracts without weakening Platform/Tenant behavior.
- [ ] Partner permission keys are exact, closed, and carry approved delegability metadata.
- [ ] `partner_owner` and `partner_admin` exist as immutable Partner system roles; no Partner custom roles exist.
- [ ] Partner root/membership/system-role tables use tenant-safe composite identities and FORCE RLS.
- [ ] Partner session persistence can carry Partner ID plus Partner/PartnerMembership authorization versions.
- [ ] Stable identities and revoked membership history cannot be retargeted/reactivated through normal direct DML.
- [ ] `booking_app` has exact minimum DML and no Partner-table DELETE grant.
- [ ] Partner domain state rules are pure and framework-free.
- [ ] Partner repositories/query adapters are transaction-bound and do not expose Prisma through application ports.
- [ ] Identity-access, dynamic-RBAC, architecture, migration, API E2E/RLS, generated contracts, and build remain green.
