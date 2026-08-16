# Sprint 2 Tenant Dynamic RBAC Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-scoped dynamic RBAC with custom role CRUD, permission composition, membership assignment/revocation, authoritative permission aggregation, authorization-version invalidation, FORCE RLS, audit, concurrency safety, and `S2-RBAC01`–`S2-RBAC16` acceptance evidence without weakening the verified Sprint 1B auth kernel.

**Architecture:** Keep seeded `platform_admin`, `tenant_owner`, and `tenant_admin` in the existing global system-role tables. Add a separate tenant-owned custom-role aggregate with three FORCE-RLS tables, expose it through `AuthorizationModule`, and extend tenant effective permission loading as `system-role permissions UNION active custom-role permissions`; custom roles never enter `AuthorizationContext.roleKeys`. Every authority-changing mutation executes through `TenantTransactionPort`, writes audit in the same transaction, and bumps affected `TenantMembership.authorizationVersion` values before commit.

**Tech Stack:** Node.js 22+, pnpm 10, TypeScript 5.9, NestJS 11.1, Prisma 6.19, PostgreSQL 17 FORCE RLS, Node test runner, Supertest, OpenAPI generation/compatibility tooling, existing Booking OS architecture/migration/Genesis verification scripts.

## Global Constraints

- Start implementation from the approved Sprint 2 design baseline `c6959fba59baa39d4f37cf5ddfec64df9e7fd853` in an isolated implementation branch/worktree; do not add Sprint 2 code to PR #31.
- Follow RED -> GREEN -> REFACTOR. Each task must begin with a failing focused test and end with a buildable commit.
- `AuthorizationContext.roleKeys` remains the closed system-role contract: `platform_admin | tenant_owner | tenant_admin`.
- Tenant custom roles contribute permissions only; custom role UUIDs/names never appear in `roleKeys` and never become permission identifiers.
- Permission identifiers remain code-seeded, append-only Permission Catalog V2 keys. No tenant API creates, renames, or deletes permission identifiers.
- Sprint 2 mutations are owner-governed. `tenant_admin` receives read-only RBAC permissions by default and may not mutate RBAC.
- Every `tenant.rbac.*` mutation permission, `tenant.membership.owner.promote`, and `tenant.membership.owner.demote` is non-delegable to custom roles.
- A permission may be added to a custom role only when it is known, tenant-scoped, delegable, and present in the actor's current authoritative permission set.
- Tenant identity comes only from trusted hostname resolution / `TenantExecutionContext`; RBAC endpoints never accept tenant identity from request body/query/arbitrary headers.
- `tenant_custom_roles`, `tenant_custom_role_permissions`, and `tenant_custom_role_assignments` each carry non-null `tenant_id`, enable RLS + FORCE RLS, and deny missing/cross-tenant context.
- Custom-role assignments target `TenantMembership.id`, not raw user IDs.
- Role metadata and permission mutations use optimistic `expectedVersion`; `TenantCustomRole.version` starts at 1 and increments exactly once for every persisted role mutation.
- Metadata-only role changes do not bump membership authorization versions.
- Permission-set replacement, role archive, assignment grant, and assignment revoke bump every affected active membership authorization version exactly once per real authority change.
- A repeated assignment revoke that changes no authority is an idempotent no-op and does not bump authorization version again.
- Unsafe HTTP mutations keep the existing same-origin + CSRF protections; protected routes use `PermissionGuard` + `RequiresPermission` and authoritative current-scope context.
- RBAC mutation/audit commit or roll back together. Metrics must use low-cardinality labels only and never tenant/user/membership/role/permission identifiers as labels.
- Full Role Builder UI, platform custom roles, partner roles, arbitrary permission creation, and custom-role invitation redesign remain out of scope.
- Dedicated closeout command is exactly `pnpm verify:dynamic-rbac`, and protected `verify:foundation` must invoke it before Sprint 2 is claimed complete.

---

### Task 1: Extend Permission Catalog V2 and Define Pure Tenant RBAC Grant Policy

**Files:**
- Modify: `packages/auth/src/permissions.ts`
- Modify: `packages/auth/src/authorization.ts`
- Modify: `packages/auth/src/index.ts`
- Modify/Test: existing `packages/auth/src/**/*.test.ts` catalog/authorization tests
- Create: `packages/auth/src/permission-catalog.ts`
- Create: `packages/auth/src/permission-catalog.test.ts`
- Create: `apps/api/src/modules/authorization/domain/tenant-rbac/tenant-rbac-grant-policy.ts`
- Create: `apps/api/src/modules/authorization/domain/tenant-rbac/tenant-rbac-grant-policy.test.ts`
- Modify: `apps/api/prisma/seed.ts`

**Interfaces:**
- Produces:
```ts
export interface PermissionCatalogEntry {
  readonly key: PermissionKey;
  readonly scopeLevel: "platform" | "tenant";
  readonly delegable: boolean;
  readonly description: string;
}

export function getPermissionCatalogEntry(key: string): PermissionCatalogEntry | null;
export function isDelegableTenantPermission(key: PermissionKey): boolean;

export interface TenantRbacGrantPolicyInput {
  readonly actorSystemRoles: readonly SystemRole[];
  readonly actorPermissionKeys: readonly PermissionKey[];
}

export function canMutateTenantRbac(input: TenantRbacGrantPolicyInput): boolean;
export function canAddTenantRolePermission(
  input: TenantRbacGrantPolicyInput,
  permission: PermissionKey,
): boolean;
```
- Catalog appends exactly:
```text
tenant.rbac.permission.read
tenant.rbac.role.read
tenant.rbac.role.create
tenant.rbac.role.update
tenant.rbac.role.archive
tenant.rbac.role.permission.grant
tenant.rbac.role.permission.revoke
tenant.rbac.assignment.read
tenant.rbac.assignment.grant
tenant.rbac.assignment.revoke
```
- `tenant_owner`: all ten Sprint 2 keys.
- `tenant_admin`: `tenant.rbac.permission.read`, `tenant.rbac.role.read`, `tenant.rbac.assignment.read` only.

- [ ] **Step 1: Write failing catalog and grant-policy tests**

Add assertions equivalent to:
```ts
assert.equal(getPermissionCatalogEntry("tenant.rbac.role.create")?.delegable, false);
assert.equal(getPermissionCatalogEntry("tenant.rbac.role.read")?.scopeLevel, "tenant");
assert.equal(getPermissionCatalogEntry("not.real"), null);
assert.equal(
  canMutateTenantRbac({
    actorSystemRoles: [SYSTEM_ROLES.tenantAdmin],
    actorPermissionKeys: [PERMISSION_KEYS.tenantRbacRoleCreate],
  }),
  false,
);
assert.equal(
  canAddTenantRolePermission(ownerContext, PERMISSION_KEYS.tenantMembershipOwnerPromote),
  false,
);
```
Also assert owner/admin seeded role mappings match the approved catalog exactly and existing permission keys remain unchanged.

- [ ] **Step 2: Run RED tests**

Run:
```bash
pnpm --filter @booking-os/auth test
pnpm --filter @booking-os/api test -- tenant-rbac-grant-policy.test.ts
```
Expected: FAIL because Sprint 2 permission keys/catalog metadata/grant policy do not exist.

- [ ] **Step 3: Implement the minimal catalog metadata and policy**

Implement `PERMISSION_CATALOG` as an immutable code-owned map/list. Mark all `tenant.rbac.*` mutation keys plus owner promote/demote as non-delegable. Keep unknown strings out of `PermissionKey`; `getPermissionCatalogEntry()` accepts `string` and returns null for unknown values.

Implement mutation governance as:
```ts
export function canMutateTenantRbac(input: TenantRbacGrantPolicyInput): boolean {
  return input.actorSystemRoles.includes(SYSTEM_ROLES.tenantOwner);
}

export function canAddTenantRolePermission(
  input: TenantRbacGrantPolicyInput,
  permission: PermissionKey,
): boolean {
  const entry = getPermissionCatalogEntry(permission);
  return (
    canMutateTenantRbac(input) &&
    entry?.scopeLevel === "tenant" &&
    entry.delegable &&
    input.actorPermissionKeys.includes(permission)
  );
}
```
Update `ROLE_PERMISSIONS` and `apps/api/prisma/seed.ts` deterministically with the ten new permission rows and owner/admin mappings. Do not change existing UUIDs/keys; allocate new stable seed UUIDs after the current `...218` range.

- [ ] **Step 4: Run GREEN tests and seed/type checks**

Run:
```bash
pnpm --filter @booking-os/auth test
pnpm --filter @booking-os/auth typecheck
pnpm --filter @booking-os/api test -- tenant-rbac-grant-policy.test.ts
pnpm --filter @booking-os/api typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth apps/api/src/modules/authorization/domain/tenant-rbac apps/api/prisma/seed.ts
git commit -m "feat: extend tenant RBAC permission catalog"
```

---

### Task 2: Add Tenant Custom-RBAC Schema, Constraints, FORCE RLS, and Migration Verification

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260816_tenant_dynamic_rbac/migration.sql`
- Modify: existing tenant policy manifest/verifier under `apps/api/src/modules/tenancy/infrastructure/persistence/`
- Modify/Test: `apps/api/scripts/verify-tenant-policies.ts` and its existing tests where applicable
- Create: `apps/api/test/tenant-rbac-schema.integration.test.ts`
- Create: `apps/api/test/tenant-rbac-rls.integration.test.ts`
- Modify: `scripts/verify-migrations.mjs`

**Interfaces:**
- Produces Prisma models equivalent to:
```prisma
model TenantCustomRole {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId       String   @db.Uuid @map("tenant_id")
  name           String
  normalizedName String   @map("normalized_name")
  description    String?
  version        Int      @default(1)
  archivedAt     DateTime? @db.Timestamptz(6) @map("archived_at")
  createdAt      DateTime @default(now()) @db.Timestamptz(6) @map("created_at")
  updatedAt      DateTime @default(now()) @updatedAt @db.Timestamptz(6) @map("updated_at")
  @@unique([id, tenantId])
  @@map("tenant_custom_roles")
}
```
plus tenant-bound permission mappings and membership assignments with composite same-tenant foreign keys.

- [ ] **Step 1: Write failing schema/RLS tests**

Tests must prove:
```text
- active normalized role name is unique within one tenant and allowed in another tenant
- mapping requires same tenant role and tenant-scoped Permission row
- assignment requires same tenant role + membership
- only one active assignment exists for (tenant, membership, role)
- archived roles reject new mappings and assignments
- all three tables deny cross-tenant SELECT/INSERT/UPDATE/DELETE under booking_app
- all three tables deny access when app.tenant_id is missing
- policy verifier lists all three tables
```

- [ ] **Step 2: Run RED persistence tests**

Run:
```bash
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-schema.integration.test.ts tenant-rbac-rls.integration.test.ts
pnpm --filter @booking-os/api verify:tenant-policies
pnpm verify:migrations
```
Expected: FAIL because the tables/policies/constraints are absent.

- [ ] **Step 3: Implement additive migration and Prisma schema**

Migration must create:
```text
tenant_custom_roles
tenant_custom_role_permissions
tenant_custom_role_assignments
```
with non-null `tenant_id`, composite uniqueness needed by same-tenant foreign keys, partial unique indexes for active names and active assignments, RLS + FORCE RLS, and the existing `current_setting('app.tenant_id', true)` policy shape.

Add transaction-time database checks/triggers so a permission mapping cannot reference a platform-scoped permission and no active mapping/assignment can be created for an archived role. SQL migration is authoritative where Prisma cannot express partial indexes/triggers.

- [ ] **Step 4: Extend policy/migration verification**

Update the tenant policy manifest and `scripts/verify-migrations.mjs` to fail if any Sprint 2 table loses FORCE RLS, tenant policy, active-name uniqueness, active-assignment uniqueness, same-tenant FK, permission-scope guard, or archived-role guard.

- [ ] **Step 5: Run GREEN persistence tests**

Run:
```bash
pnpm --filter @booking-os/api prisma:generate
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-schema.integration.test.ts tenant-rbac-rls.integration.test.ts
pnpm --filter @booking-os/api verify:tenant-policies
pnpm verify:migrations
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/test/tenant-rbac-* apps/api/src/modules/tenancy scripts/verify-migrations.mjs
git commit -m "feat: add tenant custom RBAC schema"
```

---

### Task 3: Add Tenant RBAC Domain, Ports, and Transaction-Bound Prisma Adapters

**Files:**
- Create: `apps/api/src/modules/authorization/domain/tenant-rbac/tenant-custom-role.ts`
- Create: `apps/api/src/modules/authorization/domain/tenant-rbac/tenant-custom-role-name.ts`
- Create: `apps/api/src/modules/authorization/domain/tenant-rbac/tenant-rbac.errors.ts`
- Create: `apps/api/src/modules/authorization/application/ports/tenant-custom-role-repository.port.ts`
- Create: `apps/api/src/modules/authorization/application/ports/tenant-custom-role-assignment-repository.port.ts`
- Create: `apps/api/src/modules/authorization/application/ports/tenant-rbac-permission-repository.port.ts`
- Create: `apps/api/src/modules/authorization/application/ports/tenant-rbac-data-session.ts`
- Create: `apps/api/src/modules/authorization/infrastructure/persistence/prisma/prisma-tenant-custom-role-repository.adapter.ts`
- Create: `apps/api/src/modules/authorization/infrastructure/persistence/prisma/prisma-tenant-custom-role-assignment-repository.adapter.ts`
- Create: `apps/api/src/modules/authorization/infrastructure/persistence/prisma/prisma-tenant-rbac-permission-repository.adapter.ts`
- Create tests beside each domain/adapter file
- Modify: `apps/api/src/modules/tenancy/application/ports/tenant-transaction.port.ts`
- Modify: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.ts`

**Interfaces:**
- Produces:
```ts
export interface TenantCustomRoleRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
  readonly version: number;
  readonly archivedAt: Date | null;
  readonly permissionKeys: readonly PermissionKey[];
}

export interface TenantCustomRoleRepositoryPort {
  list(): Promise<readonly TenantCustomRoleRecord[]>;
  findById(id: string): Promise<TenantCustomRoleRecord | null>;
  lockById(id: string): Promise<TenantCustomRoleRecord | null>;
  create(input: CreateTenantCustomRoleRecordInput): Promise<TenantCustomRoleRecord>;
  updateMetadata(input: UpdateTenantCustomRoleMetadataRecordInput): Promise<TenantCustomRoleRecord>;
  replacePermissions(roleId: string, permissionIds: readonly string[]): Promise<void>;
  archive(roleId: string, now: Date): Promise<TenantCustomRoleRecord>;
  listActiveHolderMembershipIds(roleId: string): Promise<readonly string[]>;
}

export interface TenantCustomRoleAssignmentRepositoryPort {
  listActiveForMembership(membershipId: string): Promise<readonly TenantCustomRoleAssignmentRecord[]>;
  findActive(membershipId: string, roleId: string): Promise<TenantCustomRoleAssignmentRecord | null>;
  grant(membershipId: string, roleId: string, now: Date): Promise<TenantCustomRoleAssignmentRecord>;
  revoke(membershipId: string, roleId: string, now: Date): Promise<boolean>;
  revokeAllForRole(roleId: string, now: Date): Promise<readonly string[]>;
}

export interface TenantRbacPermissionRepositoryPort {
  findTenantPermissionsByKeys(keys: readonly PermissionKey[]): Promise<readonly { id: string; key: PermissionKey }[]>;
}

export interface TenantRbacDataSession {
  readonly customRoles: TenantCustomRoleRepositoryPort;
  readonly customRoleAssignments: TenantCustomRoleAssignmentRepositoryPort;
  readonly rbacPermissions: TenantRbacPermissionRepositoryPort;
}
```
`TenantDataSession` extends `MembershipDataSession` and exposes these three capabilities without exposing Prisma.

- [ ] **Step 1: Write failing domain/adapter tests**

Cover role-name NFKC/trim/whitespace/lowercase normalization, bounded non-empty name validation, deterministic permission ordering, archived-row mapping, transaction tenant derivation, row locking, and adapter denial of foreign tenant IDs.

- [ ] **Step 2: Run RED tests**

Run:
```bash
pnpm --filter @booking-os/api test -- tenant-custom-role tenant-rbac-permission prisma-tenant-custom-role prisma-tenant-custom-role-assignment
```
Expected: FAIL because domain types/ports/adapters do not exist.

- [ ] **Step 3: Implement domain and ports**

Use stable error classes with codes from the design, including:
```text
TENANT_CUSTOM_ROLE_NOT_FOUND
TENANT_CUSTOM_ROLE_NAME_CONFLICT
TENANT_CUSTOM_ROLE_ARCHIVED
TENANT_CUSTOM_ROLE_VERSION_CONFLICT
TENANT_RBAC_PERMISSION_UNKNOWN
TENANT_RBAC_PERMISSION_SCOPE_INVALID
TENANT_RBAC_PERMISSION_NOT_DELEGABLE
TENANT_RBAC_PERMISSION_GRANT_NOT_ALLOWED
TENANT_RBAC_ASSIGNMENT_NOT_ALLOWED
TENANT_RBAC_ASSIGNMENT_NOT_FOUND
```
No error exposes Prisma/SQL strings.

- [ ] **Step 4: Implement transaction-bound Prisma adapters**

Construct the adapters only inside `PrismaTenantTransactionAdapter` with the transaction already under `booking_app` + transaction-local `app.tenant_id`. All adapter queries include tenant-safe resource semantics; lock methods use `SELECT ... FOR UPDATE` under the current tenant transaction.

- [ ] **Step 5: Run GREEN tests + architecture**

Run:
```bash
pnpm --filter @booking-os/api test -- tenant-custom-role tenant-rbac-permission prisma-tenant-custom-role prisma-tenant-custom-role-assignment
pnpm --filter @booking-os/api typecheck
pnpm verify:architecture
```
Expected: PASS; no authorization code imports membership/tenancy infrastructure.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/authorization apps/api/src/modules/tenancy
git commit -m "feat: add tenant RBAC application boundary"
```

---

### Task 4: Implement Custom Role Read, Create, and Metadata Update Use Cases

**Files:**
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/list-tenant-permissions.use-case.ts`
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/list-tenant-custom-roles.use-case.ts`
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/get-tenant-custom-role.use-case.ts`
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/create-tenant-custom-role.use-case.ts`
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/update-tenant-custom-role.use-case.ts`
- Create matching `.test.ts` files
- Modify: `apps/api/src/common/security/security-audit-events.ts`
- Modify: `apps/api/src/modules/memberships/application/ports/tenant-security-audit.port.ts`

**Interfaces:**
- Consumes authoritative `AuthorizationContext`, trusted `TenantExecutionContext`, `TenantTransactionPort`, catalog metadata, and `session.audit`.
- Produces use cases whose mutation inputs contain actor context + request ID + resource data, never tenant ID supplied by the client.

- [ ] **Step 1: Write failing use-case tests**

Cover:
```text
- owner lists catalog/roles and creates role
- tenant admin can list but create/update is denied
- create with initial permissions is atomic and validates every requested permission
- duplicate normalized name maps to TENANT_CUSTOM_ROLE_NAME_CONFLICT
- metadata update requires expectedVersion
- stale expectedVersion changes nothing
- metadata no-op changes neither role version nor membership version
- persisted metadata change increments role.version once but no membership authorization version
- role created/updated audit is inside the transaction
```

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter @booking-os/api test -- list-tenant-permissions list-tenant-custom-roles get-tenant-custom-role create-tenant-custom-role update-tenant-custom-role
```
Expected: FAIL because use cases are absent.

- [ ] **Step 3: Implement read/create/update orchestration**

Create role flow:
```text
validate owner governance -> normalize metadata -> validate complete initial permission set -> enter one tenant transaction -> resolve seeded permission IDs -> create role -> create mappings -> append tenant.rbac.role.created audit -> commit
```
Metadata update flow locks role, checks `expectedVersion`, persists only actual metadata changes, increments role version exactly once on change, and appends `tenant.rbac.role.updated` audit.

- [ ] **Step 4: Extend typed audit event union**

Append exactly:
```text
tenant.rbac.role.created
tenant.rbac.role.updated
tenant.rbac.role.permissions_changed
tenant.rbac.role.archived
tenant.rbac.assignment.granted
tenant.rbac.assignment.revoked
```
and extend `TenantSecurityAuditEventType` to include `tenant.rbac.${string}` through the central closed event union rather than widening to arbitrary strings.

- [ ] **Step 5: Run GREEN tests**

```bash
pnpm --filter @booking-os/api test -- list-tenant-permissions list-tenant-custom-roles get-tenant-custom-role create-tenant-custom-role update-tenant-custom-role
pnpm --filter @booking-os/api typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/authorization apps/api/src/common/security apps/api/src/modules/memberships/application/ports/tenant-security-audit.port.ts
git commit -m "feat: manage tenant custom roles"
```

---

### Task 5: Implement Atomic Permission-Set Replacement and Role Archive

**Files:**
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.ts`
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/archive-tenant-custom-role.use-case.ts`
- Create matching unit tests
- Create: `apps/api/test/tenant-rbac-role-concurrency.e2e.test.ts`

**Interfaces:**
- Permission replace input:
```ts
interface ReplaceTenantCustomRolePermissionsInput {
  readonly authorization: ActiveTenantAuthorizationContext;
  readonly roleId: string;
  readonly permissionKeys: readonly PermissionKey[];
  readonly expectedVersion: number;
  readonly requestId: string | null;
  readonly now: Date;
}
```
- Archive input has `roleId`, `expectedVersion`, actor authorization, request ID, and `now`.

- [ ] **Step 1: Write failing version/invalidation/concurrency tests**

Cover `S2-RBAC05`, `S2-RBAC06`, `S2-RBAC07`, `S2-RBAC08`, and archive behavior:
```text
- unknown/platform/non-delegable/not-held added permission fails atomically
- permission removal remains allowed to authorized owner
- unchanged desired permission set is success/no-op: no role or membership version bump
- changed set increments role version once
- active holder membership IDs are sorted before lockById calls
- every active holder authorizationVersion increments once
- stale expectedVersion commits nothing
- two concurrent replacements with same version produce at most one authority-changing commit
- archive revokes active assignments, increments role version once and each affected active membership once
- archive vs grant / archive vs replace cannot commit invalid mixed state
```

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter @booking-os/api test -- replace-tenant-custom-role-permissions archive-tenant-custom-role
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-role-concurrency.e2e.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement permission-set replace**

Inside one `TenantTransactionPort.run()`:
```text
lock role -> compare expectedVersion -> compute deterministic added/removed set -> validate every addition -> no-op if set identical -> replace mappings -> increment role.version -> obtain active holder membership IDs -> sort UUIDs -> lock each membership in order -> increment each active holder authorization version once -> append bounded tenant.rbac.role.permissions_changed audit -> commit
```
Audit metadata contains role UUID, prior/new role version, and bounded added/removed permission keys only.

- [ ] **Step 4: Implement archive**

Inside one tenant transaction:
```text
lock role -> verify expectedVersion -> soft archive role -> revoke all active assignments -> increment role.version once -> sort affected membership IDs -> lock/increment active memberships once -> append tenant.rbac.role.archived audit -> commit
```
Retain permission mappings and revoked assignments. No restore endpoint/use case.

- [ ] **Step 5: Run GREEN concurrency tests**

```bash
pnpm --filter @booking-os/api test -- replace-tenant-custom-role-permissions archive-tenant-custom-role
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-role-concurrency.e2e.test.ts
pnpm verify:migrations
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/authorization apps/api/test/tenant-rbac-role-concurrency.e2e.test.ts
git commit -m "feat: update tenant role authority atomically"
```

---

### Task 6: Implement Membership Custom-Role Assignment and Revocation

**Files:**
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/list-membership-custom-roles.use-case.ts`
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/grant-membership-custom-role.use-case.ts`
- Create: `apps/api/src/modules/authorization/application/use-cases/tenant-rbac/revoke-membership-custom-role.use-case.ts`
- Create matching unit tests
- Create: `apps/api/test/tenant-rbac-assignment-concurrency.e2e.test.ts`

**Interfaces:**
- Assignment mutations target `{ membershipId, roleId }`, never user ID/tenant ID.
- Reuse `MembershipRepositoryPort.lockById()` and `incrementAuthorizationVersion()` from the existing tenant transaction session.

- [ ] **Step 1: Write failing assignment tests**

Cover `S2-RBAC09` and `S2-RBAC10`:
```text
- owner grants active same-tenant role to active same-tenant membership
- tenant admin mutation denied
- inactive membership denied with MEMBERSHIP_INACTIVE
- foreign/missing membership or role fails with safe same-tenant not-found semantics
- archived role cannot be assigned
- first real grant increments target membership authorization version once
- duplicate grant produces one active assignment and no duplicate version increment
- first revoke marks assignment revoked and increments membership version once
- repeated revoke is safe idempotent no-op with no second version increment
- concurrent duplicate grant/revoke converges safely
```

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter @booking-os/api test -- membership-custom-role grant-membership-custom-role revoke-membership-custom-role
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-assignment-concurrency.e2e.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement grant flow**

Inside one tenant transaction:
```text
owner policy -> lock active role -> lock target membership -> detect existing active assignment -> if already active return no-op -> create assignment -> increment membership authorization version once -> append tenant.rbac.assignment.granted audit -> commit
```
Handle unique-conflict races by re-reading the active assignment inside the transaction/retry strategy already used by repository patterns; never increment version for a losing duplicate request.

- [ ] **Step 4: Implement revoke flow**

Inside one tenant transaction:
```text
owner policy -> lock role/membership in stable order -> revoke active assignment if present -> if changed increment membership authorization version once + audit -> if already revoked/missing matching historical resource return defined safe idempotent result without authority bump
```
Cross-tenant UUIDs must not reveal existence.

- [ ] **Step 5: Run GREEN tests**

```bash
pnpm --filter @booking-os/api test -- membership-custom-role grant-membership-custom-role revoke-membership-custom-role
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-assignment-concurrency.e2e.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/authorization apps/api/test/tenant-rbac-assignment-concurrency.e2e.test.ts
git commit -m "feat: assign tenant custom roles safely"
```

---

### Task 7: Union Custom-Role Permissions Into Authoritative Tenant Authorization

**Files:**
- Modify: `apps/api/src/modules/memberships/infrastructure/persistence/prisma/prisma-tenant-authorization-query.adapter.ts`
- Modify/Test: `apps/api/src/modules/memberships/infrastructure/persistence/prisma/prisma-tenant-authorization-query.adapter.test.ts`
- Modify/Test: `apps/api/src/modules/authorization/infrastructure/persistence/prisma/prisma-authorization-repository.adapter.test.ts`
- Modify/Test: `apps/api/src/modules/authorization/application/use-cases/build-authorization-context.use-case.test.ts`
- Create: `apps/api/test/tenant-rbac-authoritative-context.e2e.test.ts`

**Interfaces:**
- `AuthorizationContext.roleKeys` type remains unchanged.
- Tenant `permissionKeys` becomes de-duplicated sorted union of system-role permissions plus permissions contributed through active custom-role assignments for the current active membership.

- [ ] **Step 1: Write failing effective-authority tests**

Cover `S2-RBAC13` and `S2-RBAC14`:
```text
- custom role contributes one delegable permission to permissionKeys
- custom role UUID/name never appears in roleKeys
- revoked assignment contributes nothing
- archived role contributes nothing
- unknown/wrong-scope permission row fails closed rather than widening authority
- permission output is unique and sorted
- membership version mismatch forces existing reconcile/refresh path before protected use case
- revocation or permission removal prevents stale authority from executing a protected use case
- /auth/me/authorization remains current-scope-only and Cache-Control private, no-store
```

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter @booking-os/api test -- prisma-tenant-authorization-query build-authorization-context prisma-authorization-repository
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-authoritative-context.e2e.test.ts
```
Expected: FAIL because the tenant authority query currently only accepts system roles and system-role permissions.

- [ ] **Step 3: Extend tenant authority SQL safely**

Keep the existing system-role `roleKeys` aggregation unchanged. Add a separate custom-role permission contribution joined through:
```text
tenant_memberships
-> tenant_custom_role_assignments (active)
-> tenant_custom_roles (not archived)
-> tenant_custom_role_permissions
-> permissions (tenant scope)
```
all constrained to the current transaction tenant. Union this with system-role permission keys; de-duplicate/sort before returning.

Do not expand `AUTHORIZATION_ROLE_KEYS` or `AuthorizationRoleKey` in `packages/contracts`.

- [ ] **Step 4: Preserve fail-closed catalog validation**

Update known-value validation to accept the newly appended code-owned Permission Catalog V2 keys but continue returning null/failing authority when a database row contains an identifier outside the code catalog.

- [ ] **Step 5: Run GREEN authorization/regression tests**

```bash
pnpm --filter @booking-os/api test -- prisma-tenant-authorization-query build-authorization-context prisma-authorization-repository
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-authoritative-context.e2e.test.ts authorization-context-concurrency.e2e.test.ts
pnpm verify:identity-access
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/memberships apps/api/src/modules/authorization apps/api/test/tenant-rbac-authoritative-context.e2e.test.ts
git commit -m "feat: resolve tenant custom role permissions"
```

---

### Task 8: Expose Normative Tenant RBAC HTTP API, Error Mapping, OpenAPI, and Module Composition

**Files:**
- Create: `apps/api/src/modules/authorization/infrastructure/http/tenant-rbac.controller.ts`
- Create: `apps/api/src/modules/authorization/infrastructure/http/tenant-rbac.controller.test.ts`
- Create DTO/schema files beside controller following current authorization HTTP conventions
- Modify: `apps/api/src/modules/authorization/authorization.module.ts`
- Modify: `apps/api/src/modules/authorization/authorization.tokens.ts` only for new provider tokens required by explicit ports
- Create: `apps/api/test/tenant-rbac-api.e2e.test.ts`
- Modify generated OpenAPI through existing `pnpm api:generate` workflow; do not hand-edit generated API client/schema files except through generator outputs

**Interfaces / Routes:**
```text
GET    /tenant/rbac/permissions
GET    /tenant/rbac/roles
POST   /tenant/rbac/roles
GET    /tenant/rbac/roles/:roleId
PATCH  /tenant/rbac/roles/:roleId
PUT    /tenant/rbac/roles/:roleId/permissions
DELETE /tenant/rbac/roles/:roleId
GET    /tenant/rbac/memberships/:membershipId/roles
POST   /tenant/rbac/memberships/:membershipId/roles/:roleId
DELETE /tenant/rbac/memberships/:membershipId/roles/:roleId
```
Mutation DTOs use `expectedVersion` exactly where the design requires it. No DTO accepts `tenantId`.

- [ ] **Step 1: Write failing controller/E2E tests**

Cover `S2-RBAC01`–`S2-RBAC06` at HTTP level plus:
```text
- exact tenant hostname/session required
- read routes require read permissions
- owner mutation succeeds
- tenant-admin mutation denied by authoritative permission + owner governance
- unsafe methods require existing CSRF/origin protections
- foreign role/membership IDs use safe not-found/denied semantics
- system-role IDs/keys cannot be mutated through these routes
- responses never echo SQL/Prisma detail
- authorization/RBAC responses set private no-store where current security conventions require it
```

- [ ] **Step 2: Run RED API tests**

```bash
pnpm --filter @booking-os/api test -- tenant-rbac.controller.test.ts
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-api.e2e.test.ts
```
Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement controller + composition**

Use `@RequiresPermission(PERMISSION_KEYS....)` on every route and read the authoritative context already attached by `PermissionGuard` via `authorizationContextFromRequest(request)`. Controllers validate transport DTOs and invoke use cases only; no Prisma queries and no system-role business branching in controller code.

Register use cases/adapters in `AuthorizationModule` with explicit factory/provider bindings. `TenancyModule` remains the transaction boundary; no new network service is introduced.

- [ ] **Step 4: Implement stable HTTP error mapping**

Map version conflict to HTTP 409; invalid DTO/catalog input to safe 400/422 consistent with existing API conventions; authorization/grant denial to 403; foreign/inaccessible resource IDs to safe 404/403 convention without existence leakage. Tests assert stable machine error codes in response bodies.

- [ ] **Step 5: Generate and verify OpenAPI**

```bash
pnpm api:generate
pnpm api:check-generated
pnpm api:check-breaking
```
Expected: PASS with only additive Sprint 2 routes/contracts.

- [ ] **Step 6: Run GREEN API + architecture tests**

```bash
pnpm --filter @booking-os/api test -- tenant-rbac.controller.test.ts
pnpm --filter @booking-os/api test:e2e -- tenant-rbac-api.e2e.test.ts
pnpm verify:architecture
pnpm api:check-generated
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/authorization apps/api/test/tenant-rbac-api.e2e.test.ts packages/contracts/openapi packages/api-client/src/generated
git commit -m "feat: expose tenant RBAC API"
```

---

### Task 9: Add Sprint 2 Acceptance Verifier, Protected CI Integration, and Security Regression Matrix

**Files:**
- Create: `scripts/verify-dynamic-rbac.mjs`
- Create: `scripts/verify-dynamic-rbac.test.mjs`
- Modify: root `package.json`
- Modify: protected CI/Foundation workflow/config files that currently invoke `verify:identity-access`
- Create: `apps/api/test/tenant-rbac-acceptance.e2e.test.ts`
- Modify relevant architecture/migration/security test registries only where required to include Sprint 2 artifacts

**Interfaces:**
- Adds exact root command:
```json
"verify:dynamic-rbac": "node scripts/verify-dynamic-rbac.mjs"
```
- `verify:foundation` invokes `pnpm verify:dynamic-rbac` after migrations and identity-access verification, before final build/browser/production-config gates.

- [ ] **Step 1: Write RED verifier expectations first**

`verify-dynamic-rbac.test.mjs` must fail until the repository contains and exercises named evidence for all `S2-RBAC01`–`S2-RBAC16`. The verifier must check concrete test files/markers/commands, not merely search for the string `dynamic-rbac`.

- [ ] **Step 2: Run RED verifier**

```bash
node --test scripts/verify-dynamic-rbac.test.mjs
```
Expected: FAIL because verifier/acceptance integration is incomplete.

- [ ] **Step 3: Build the dedicated acceptance test**

`tenant-rbac-acceptance.e2e.test.ts` must contain named cases or explicit mapping comments for:
```text
S2-RBAC01 owner create/read
S2-RBAC02 normalized-name tenant isolation
S2-RBAC03 admin read-only
S2-RBAC04 system-role immutability
S2-RBAC05 invalid/non-delegable permission rejection
S2-RBAC06 cannot grant more than actor
S2-RBAC07 permission replace versions
S2-RBAC08 stale expectedVersion atomic rejection
S2-RBAC09 same-tenant active membership assignment
S2-RBAC10 duplicate grant/revoke concurrency
S2-RBAC11 archive consequences
S2-RBAC12 FORCE RLS / missing context
S2-RBAC13 permission-only custom authority
S2-RBAC14 stale session reconciliation before use case
S2-RBAC15 transactional bounded secret-safe audit
S2-RBAC16 Sprint 1B + protected gates regression
```
Reuse focused integration tests as supporting evidence but ensure the dedicated verifier can resolve each acceptance ID to an executable test/gate.

- [ ] **Step 4: Implement verifier and protected command wiring**

`verify-dynamic-rbac.mjs` executes the minimum deterministic acceptance set and exits non-zero on any failed command. Do not swallow subprocess exit codes. Add the command to `package.json` and wire it into `verify:foundation` and the protected CI workflow path.

- [ ] **Step 5: Run GREEN dedicated verification**

```bash
node --test scripts/verify-dynamic-rbac.test.mjs
pnpm verify:dynamic-rbac
pnpm verify:identity-access
pnpm verify:architecture
pnpm verify:migrations
```
Expected: PASS.

- [ ] **Step 6: Run complete repository closeout gates**

Run fresh from the implementation head:
```bash
pnpm check:ci
pnpm api:check-generated
pnpm api:check-breaking
pnpm infra:config
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm test
pnpm test:e2e:api
pnpm verify:migrations
pnpm verify:identity-access
pnpm verify:dynamic-rbac
pnpm verify:architecture
pnpm build
pnpm test:e2e
pnpm verify:production-config
pnpm audit --audit-level=high
```
Also execute the repository's existing committed-secret scan command/workflow exactly as defined by CI. No completion claim is valid if only focused RBAC tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-dynamic-rbac* package.json .github apps/api/test/tenant-rbac-acceptance.e2e.test.ts
git commit -m "test: verify Sprint 2 dynamic RBAC"
```

---

### Task 10: Close Sprint 2 Knowledge, Operations, and Review Handoff

**Files:**
- Create/update: active feature documentation under `docs/features/` for tenant dynamic RBAC
- Create/update: authorization pattern documentation under `docs/patterns/`
- Create/update: RBAC recovery guidance under `docs/runbooks/`
- Modify: `docs/architecture/BASELINE.md` only if module responsibilities materially changed
- Modify: `docs/architecture/DEPLOYMENT-UNITS.md` only if needed to record placement; do not create a new deployment unit
- Modify: `docs/ownership/DOMAIN-OWNERS.md` only if a new bounded-domain label is introduced
- Modify: `docs/plan/90-DAY-EXECUTION.md`
- Modify: `genesis/reviews/PILOT-GATES.md`
- Create: `docs/superpowers/checkpoints/2026-08-16-sprint-2-dynamic-rbac-closeout.md`
- Modify: this plan checklist/status during reconciliation

**Produces:** operationally usable closeout covering accidental assignment, permission expansion, archive impact, stale authority/session reconciliation, and mutation outage with read authorization remaining available.

- [ ] **Step 1: Write knowledge-validation expectations before closeout docs**

Extend existing Genesis/delivery validation tests so Sprint 2 closeout requires:
```text
- active Sprint 2 feature/pattern references the approved design + this plan
- exact `pnpm verify:dynamic-rbac` verification command
- runbook sections for accidental role assignment, accidental permission expansion, archived role impact, stale authority/session reconciliation, RBAC mutation outage
- authorization/domain owner is resolvable
- no secret values are placed in command-line examples
```
Run the relevant tooling test and record expected RED before docs exist.

- [ ] **Step 2: Create/update minimal closeout documentation**

Document only implemented behavior. Recovery actions must use real implemented APIs/commands/schema and must not invent an operator endpoint. Explain forward-fix rollback: mutation routes may be disabled while RBAC tables and read authorization remain intact; never delete RBAC history as rollback.

- [ ] **Step 3: Run knowledge + full protected verification again**

```bash
pnpm genesis:validate
pnpm verify:delivery-reconciliation
pnpm check:ci
pnpm verify:architecture
pnpm verify:migrations
pnpm verify:identity-access
pnpm verify:dynamic-rbac
pnpm verify:foundation
```
Expected: PASS on the exact closeout head.

- [ ] **Step 4: Create/update checkpoint with exact evidence**

Record:
```text
- RED commit/run for verifier/knowledge expectations
- GREEN implementation commits by Task
- exact final implementation/closeout SHA
- CI/protected workflow run numbers and conclusions from the same head
- S2-RBAC01–S2-RBAC16 evidence mapping
- any review-handoff gate still pending
```
Do not claim reviewer approval if no external review exists.

- [ ] **Step 5: Commit closeout docs**

```bash
git add docs genesis
git commit -m "docs: close Sprint 2 dynamic RBAC"
```

- [ ] **Step 6: Preserve review boundary**

Open/update a Sprint 2 draft PR only after the implementation branch exists and all gates are green. Keep it draft unless the user explicitly instructs otherwise. Never merge, mark ready, or fabricate/self-request a reviewer without explicit valid reviewer information.

---

## Sprint 2 Completion Gate

- [ ] Ten scoped task histories exist with RED -> GREEN evidence and independently reviewable commits.
- [ ] `tenant_custom_roles`, `tenant_custom_role_permissions`, and `tenant_custom_role_assignments` are additive, tenant-owned, same-tenant constrained, FORCE-RLS protected, and migration-verified.
- [ ] System roles remain immutable and custom roles never enter `AuthorizationContext.roleKeys`.
- [ ] Permission Catalog V2 remains code-owned/append-only; unknown, platform, non-delegable, and actor-not-held permission additions fail atomically.
- [ ] Tenant owner can mutate RBAC; tenant admin can read but cannot mutate by default.
- [ ] Metadata versioning, permission-set replacement, archive, assignment grant/revoke, and all required races meet the design's exact version/invalidation semantics.
- [ ] Effective tenant permission loading unions active custom-role permissions, de-duplicates/sorts output, and fails closed on malformed catalog data.
- [ ] Stale membership authority cannot execute protected application logic after assignment/permission revocation.
- [ ] All authority-changing RBAC mutations and audit events commit/rollback together; audit/metrics are bounded and secret-safe.
- [ ] Normative HTTP routes exist with exact tenant/session/CSRF/permission boundaries and no client-supplied tenant authority.
- [ ] `S2-RBAC01`–`S2-RBAC16` all resolve to executable passing evidence through `pnpm verify:dynamic-rbac`.
- [ ] `pnpm verify:identity-access`, migrations, architecture, OpenAPI compatibility, full API tests, build, browser/Foundation, production config, dependency audit, and committed-secret scan are fresh-green on the closeout head.
- [ ] Sprint 2 feature/pattern/runbook/ownership/90-day/Pilot checkpoint knowledge is current and Genesis validation passes.
- [ ] Full Role Builder UI, platform custom roles, partner roles, and custom-role invitation redesign remain out of scope.
- [ ] Review handoff state is recorded truthfully; no merge/mark-ready action occurs without explicit user instruction.
