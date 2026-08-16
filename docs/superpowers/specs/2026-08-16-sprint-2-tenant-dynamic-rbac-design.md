# Sprint 2 Tenant Dynamic RBAC Foundation Design

Date: 2026-08-16
Status: Approved design — implementation planning pending
Owner: authorization
Depends on:
- `2026-08-05-tenant-isolation-core-design.md`
- `2026-08-05-identity-membership-authorization-core-design.md`
Amendment: `../../spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`
Roadmap: `../../plan/90-DAY-EXECUTION.md`

## Summary

Sprint 2 introduces tenant-scoped dynamic RBAC without weakening the Sprint 1B identity/session/authorization kernel.

The design keeps `platform_admin`, `tenant_owner`, and `tenant_admin` as immutable system roles in the existing global `Role` / `RolePermission` / `RoleAssignment` model. Tenant-defined roles are stored in a separate tenant-owned aggregate with their own FORCE-RLS-protected role, permission-mapping, and membership-assignment tables.

Tenant custom roles contribute effective permissions only. They do not become authorization role identifiers, they do not appear in `AuthorizationContext.roleKeys`, and they cannot grant or simulate system-role semantics such as tenant ownership or platform administration. `AuthorizationContext.roleKeys` remains the stable system-role contract from Sprint 1B while `permissionKeys` becomes the deterministic union of permissions contributed by system roles and active custom-role assignments.

Permissions remain code-seeded, append-only identifiers from Permission Catalog V2. End users can compose tenant custom roles from approved tenant-scoped permissions but cannot create arbitrary permission strings. RBAC mutation capabilities are non-delegable in Sprint 2, so a custom role cannot bootstrap authority to mutate RBAC itself.

Every authority-changing mutation runs inside the existing tenant transaction boundary, is covered by FORCE RLS, writes a transactional tenant security-audit event, and bumps the affected `TenantMembership.authorizationVersion` values before commit. Existing stale-authority reconciliation then prevents an old session snapshot from reaching protected application logic.

Sprint 2 is backend-first. It provides the API and security foundation required by later product modules and the Phase 2 Role Builder UI. A full Role Builder interface, platform custom roles, partner custom roles, and arbitrary tenant-member invitation redesign are not part of this slice.

## Approved Product Decisions

The following decisions are approved for Sprint 2:

1. Tenant custom roles use a separate tenant-owned aggregate rather than overloading the existing global `Role` table.
2. Existing system roles remain immutable and continue to use the current `Role`, `RolePermission`, and `RoleAssignment` tables.
3. Tenant custom-role identity is a UUID. The display name is editable metadata and is never an authorization identifier.
4. Tenant custom roles contribute permissions only; they never appear in `AuthorizationContext.roleKeys`.
5. Permission Catalog V2 remains code-seeded and append-only. No API creates, renames, or deletes permission identifiers.
6. Sprint 2 custom-role mutation is owner-governed. Tenant admins may inspect RBAC state but do not receive RBAC mutation capabilities by default.
7. RBAC mutation capabilities are non-delegable to custom roles in Sprint 2.
8. A grant may include only tenant-scoped, code-seeded, delegable permissions that are present in the actor's current authoritative permission set.
9. A custom role may be assigned only to an active membership in the same tenant.
10. Assigning or revoking a custom role bumps the target membership authorization version in the same transaction.
11. Changing a role's effective permission set bumps the authorization version of every active membership holding that role, once per membership, in the same transaction.
12. Archiving a custom role revokes its active assignments and bumps every affected active membership authorization version atomically.
13. Name/description-only role edits do not bump membership authorization versions because they do not alter authority.
14. Tenant-owned custom-RBAC rows carry `tenant_id` directly and are protected by FORCE RLS. Cross-tenant safety never depends only on application filtering or joins.
15. Full tenant Role Builder UI remains deferred to Phase 2; Sprint 2 exposes a safe backend foundation and contracts only.

## Goals

1. Let an authorized tenant owner create, inspect, rename, describe, and archive tenant custom roles.
2. Let an authorized tenant owner atomically replace a custom role's permission set using code-seeded tenant permissions.
3. Let an authorized tenant owner grant or revoke a custom role for an existing active membership in the same tenant.
4. Preserve system-role immutability and final-owner protections from Sprint 1B.
5. Preserve the existing `AuthorizationContext.roleKeys` contract while extending effective `permissionKeys` through custom roles.
6. Prevent privilege escalation through arbitrary permission strings, platform permissions, RBAC self-delegation, stale authority, or cross-tenant IDs.
7. Enforce all tenant custom-RBAC persistence through the existing tenant transaction and FORCE-RLS boundary.
8. Make role permission updates, assignment changes, archive operations, and concurrent retries deterministic and auditable.
9. Add a dedicated Sprint 2 acceptance matrix and CI gate for RBAC security/concurrency behavior.
10. Establish a clean extension point for future listing, booking, finance, and partner permissions without redesigning the authorization kernel.

## Non-goals

- Custom platform roles.
- Partner-scope roles or permissions.
- Full Platform/Tenant/Partner Role Builder UI.
- End-user-created permission identifiers.
- Renaming or deleting existing permission keys.
- Replacing Permission Catalog V2 with database-authored capabilities.
- Replacing system-role owner/admin semantics with custom roles.
- Allowing a custom role to grant `tenant_owner`, `tenant_admin`, or `platform_admin` semantics.
- Moving the final-owner invariant into the custom-role model.
- Replacing `TenantMembership.authorizationVersion` with a new versioning system.
- Browser-held JWTs or a parallel authentication/session system.
- Changing hostname-derived tenant identity or the Next.js same-origin BFF boundary.
- Removing FORCE RLS or allowing an application-only tenant filter.
- A generalized invitation redesign that allows a brand-new tenant user to enter with only a custom role. Sprint 2 assignment targets existing active memberships; later tenant onboarding work may extend invitation intent to custom roles without changing this authorization model.
- Product-domain permissions that do not yet protect a real product use case.

## Baseline Constraints from Sprint 1B

Sprint 2 extends, rather than replaces, the following verified boundaries:

- `Role` contains immutable seeded system roles.
- `Permission` contains code-seeded append-only permission identifiers.
- `RolePermission` maps system roles to seeded permissions.
- `RoleAssignment` assigns system roles and carries `tenant_id` for tenant scope.
- `AuthorizationContext.roleKeys` is currently the closed system-role union `platform_admin | tenant_owner | tenant_admin`.
- Tenant effective authority is loaded inside the tenant transaction boundary.
- Tenant authorization snapshots include `TenantMembership.authorizationVersion`.
- Protected requests reconcile session authorization snapshots before application use cases execute.
- Tenant-owned authorization/membership/session/audit data is protected by FORCE RLS.
- Tenant identity comes from trusted hostname resolution, not request body/query/header tenant IDs.
- Product modules authorize through permission/resource policies rather than direct role-name branching.

These constraints remain normative unless a later dated design explicitly supersedes them.

## Architecture Decision

Sprint 2 extends the existing `AuthorizationModule` as the owner of tenant RBAC configuration. It does not create a separately deployed service and does not move membership lifecycle ownership out of `MembershipsModule`.

Conceptually:

```text
apps/api/src/modules/authorization/
├── domain/
│   └── tenant-rbac/
│       ├── tenant-custom-role.ts
│       ├── tenant-custom-role-name.ts
│       ├── tenant-rbac-grant-policy.ts
│       └── tenant-rbac.errors.ts
├── application/
│   ├── ports/
│   │   ├── tenant-custom-role-repository.port.ts
│   │   ├── tenant-custom-role-assignment-repository.port.ts
│   │   ├── tenant-permission-catalog.port.ts
│   │   └── tenant-rbac-membership.port.ts
│   └── use-cases/tenant-rbac/
│       ├── list-tenant-permissions.use-case.ts
│       ├── list-tenant-custom-roles.use-case.ts
│       ├── get-tenant-custom-role.use-case.ts
│       ├── create-tenant-custom-role.use-case.ts
│       ├── update-tenant-custom-role.use-case.ts
│       ├── replace-tenant-custom-role-permissions.use-case.ts
│       ├── archive-tenant-custom-role.use-case.ts
│       ├── list-membership-custom-roles.use-case.ts
│       ├── grant-membership-custom-role.use-case.ts
│       └── revoke-membership-custom-role.use-case.ts
├── infrastructure/
│   ├── http/
│   │   └── tenant-rbac.controller.ts
│   └── persistence/prisma/
│       ├── prisma-tenant-custom-role-repository.adapter.ts
│       ├── prisma-tenant-custom-role-assignment-repository.adapter.ts
│       └── prisma-tenant-permission-catalog.adapter.ts
└── authorization.module.ts
```

Exact file decomposition may be split further during planning when a file would otherwise take multiple responsibilities. Dependency direction remains adapter -> application -> domain.

### Module ownership

`AuthorizationModule` owns:

- tenant custom-role definitions;
- custom-role permission composition;
- custom-role assignment/revocation policy;
- RBAC mutation use cases;
- effective permission aggregation;
- RBAC HTTP endpoints and authorization policies.

`MembershipsModule` continues to own:

- tenant membership lifecycle;
- invitations;
- system-role membership transitions;
- final-owner safety;
- membership authorization version as the tenant authority epoch.

The authorization application layer may depend on technology-neutral membership capabilities such as loading an active membership, locking an affected membership set, and bumping membership authorization versions. It must not import membership Prisma adapters or membership infrastructure files.

`TenancyModule` continues to own the tenant execution transaction and capability session. Sprint 2 adds only the transaction-bound capabilities required for atomic RBAC mutations. It does not expose a generic Prisma transaction client.

## Domain Model

### Existing system-role model remains unchanged

The following tables continue to represent system authorization only:

```text
roles
permissions
role_permissions
role_assignments
```

For Sprint 2:

- rows in `roles` remain seeded system roles;
- `roles.is_system` remains true for the supported system-role rows;
- custom tenant roles are not inserted into `roles`;
- system `RoleAssignment` continues to express platform/tenant governance roles;
- existing final-owner logic continues to reason about system `tenant_owner` assignments only.

### TenantCustomRole

`TenantCustomRole`

- `id` — UUID primary key
- `tenantId` — UUID, required
- `name` — display name
- `normalizedName` — canonical value used only for active-name uniqueness
- `description` — nullable bounded text
- `version` — positive integer, starts at 1 and increments on authority-affecting permission-set changes and archive
- `archivedAt` — nullable timestamp
- `createdAt`
- `updatedAt`

Rules:

- `id` is the stable authorization-management identity.
- `name` is display metadata and may change.
- `normalizedName` uses one documented normalization function: Unicode NFKC, trim, collapse internal whitespace, then Unicode lowercase.
- active names are unique by `(tenant_id, normalized_name)` using a partial unique index where `archived_at IS NULL`.
- the same normalized role name may exist in different tenants.
- archived role names may be reused by a newly created role because UUID, not name, is the stable identity.
- archived roles are immutable except for read operations required by audit/operations.

### TenantCustomRolePermission

`TenantCustomRolePermission`

- `tenantId` — copied tenant boundary
- `roleId`
- `permissionId` — references global seeded `Permission`
- `createdAt`

Rules:

- primary identity is `(roleId, permissionId)`.
- the row also carries `tenantId` so FORCE RLS applies without joining through the role table.
- database constraints bind `(roleId, tenantId)` to the owning custom role.
- only permissions with `scopeLevel = tenant` may be referenced.
- only code-seeded Permission Catalog V2 rows may be referenced.
- non-delegable permissions are rejected by policy before mutation and again by a persistence-level invariant/verification path where practical.
- deleting a permission mapping never deletes the global permission row.

### TenantCustomRoleAssignment

`TenantCustomRoleAssignment`

- `id` — UUID primary key
- `tenantId` — copied tenant boundary
- `membershipId`
- `roleId`
- `createdAt`
- `revokedAt` — nullable timestamp

Rules:

- assignment is anchored to `membershipId`, not raw `userId`.
- `(membershipId, tenantId)` must reference a membership in the same tenant.
- `(roleId, tenantId)` must reference a custom role in the same tenant.
- only active memberships may receive a new assignment.
- archived custom roles cannot receive new assignments.
- at most one active assignment exists for the same `(tenantId, membershipId, roleId)` using a partial unique index where `revoked_at IS NULL`.
- revocation is soft so audit/history can retain assignment identity.
- an assignment does not change membership lifecycle status and does not create system-role semantics.

## Database and RLS Invariants

The migration must create tenant-owned tables equivalent to:

```text
tenant_custom_roles
tenant_custom_role_permissions
tenant_custom_role_assignments
```

All three tables must:

1. contain a non-null `tenant_id` column;
2. enable PostgreSQL RLS;
3. enable FORCE RLS;
4. use the existing transaction-local `app.tenant_id` policy pattern;
5. deny missing tenant context;
6. deny cross-tenant read/write/update/delete by primary key;
7. be included in the tenant policy manifest/verifier;
8. grant only the minimum DML required to the tenant application database role.

Tenant identity is never accepted from a route body, query parameter, or arbitrary tenant header. Route IDs such as `roleId` or `membershipId` are resource identifiers only; the current tenant still comes from trusted hostname resolution and tenant execution context.

Where Prisma cannot express a required composite or partial constraint directly, the SQL migration is authoritative and the migration verifier must prove the constraint remains present.

Required database invariants include:

- active custom-role-name uniqueness within a tenant;
- same-tenant role/permission-mapping ownership;
- same-tenant membership/role assignment ownership;
- one active custom-role assignment per membership/role pair;
- tenant-only permission scope for custom-role permission mappings;
- archived roles cannot gain new mappings or assignments through the repository path;
- permission rows themselves remain global seeded catalog rows and are never tenant-created.

## Permission Catalog V2 Extension

Sprint 2 appends only the capabilities needed to operate the RBAC foundation.

Proposed keys:

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

Naming follows the approved Permission Catalog V2 rules: lowercase dot-separated identifiers, tenant scope first, bounded resource/action semantics, and append-only compatibility.

### Default system-role mapping

`tenant_owner` receives all Sprint 2 RBAC permissions.

`tenant_admin` receives read-only RBAC permissions by default:

```text
tenant.rbac.permission.read
tenant.rbac.role.read
tenant.rbac.assignment.read
```

`platform_admin` does not receive tenant RBAC mutation authority through a platform route. A platform administrator cannot bypass tenant hostname/session/tenant-transaction boundaries to manage a tenant's custom roles.

### Non-delegable permissions

The following classes are non-delegable to tenant custom roles in Sprint 2:

1. every `tenant.rbac.*` mutation capability;
2. `tenant.membership.owner.promote`;
3. `tenant.membership.owner.demote`;
4. any later permission explicitly marked non-delegable by the code-owned catalog metadata.

Read-only RBAC permissions may be delegable if they are present in the actor's effective permission set and catalog metadata permits it.

The code-owned permission catalog therefore gains metadata in addition to the stable permission key, for example conceptual fields such as:

```ts
{
  key,
  scopeLevel: "tenant",
  delegable: true | false,
  description,
}
```

Database rows remain seed mirrors of the code-owned catalog. Database content never becomes the source of truth for whether an arbitrary identifier is valid or delegable.

## Grant-Boundary Policy

Route permission possession is necessary but not sufficient for RBAC mutations.

A dedicated pure grant policy evaluates the authoritative actor context and requested change.

### Role creation/update/archive

The actor must:

- hold the required `tenant.rbac.role.*` permission;
- be operating in the exact current tenant scope;
- have an authoritative `tenant_owner` system role for Sprint 2 mutation operations.

The owner check belongs inside the authorization/RBAC policy layer, not in controllers or product modules.

### Permission-set mutation

For every requested permission in the resulting role permission set:

- the key must exist in the code-owned Permission Catalog V2;
- the permission must be tenant-scoped;
- the permission must be marked delegable;
- the actor must currently possess the permission in the same authoritative tenant context.

This enforces "cannot grant more authority than the actor currently has" while keeping the non-delegable set explicit and testable.

Permission removal is allowed to the authorized owner even when the removed permission is no longer present in the actor's current effective set, because removal cannot increase the target role's authority. The actor must still hold the RBAC mutation capability and satisfy owner governance.

### Assignment mutation

To grant a custom role:

- actor has `tenant.rbac.assignment.grant`;
- actor satisfies owner governance;
- target membership exists, is active, and belongs to current tenant;
- custom role exists, is active, and belongs to current tenant;
- no active duplicate assignment already exists.

To revoke a custom role:

- actor has `tenant.rbac.assignment.revoke`;
- actor satisfies owner governance;
- target assignment belongs to current tenant;
- repeated revoke of an already-revoked assignment is a safe idempotent no-op when the resource identity matches.

Custom-role assignment never grants or removes `tenant_owner`, `tenant_admin`, or `platform_admin` because those remain system-role assignments under existing membership grant policy.

## Effective Authorization Model

### Stable system-role contract

`AuthorizationContext.roleKeys` remains the current closed system-role union:

```text
platform_admin
tenant_owner
tenant_admin
```

Tenant custom-role UUIDs, names, or normalized names are not inserted into `roleKeys`.

This avoids a breaking contract change in `packages/contracts`, prevents editable custom names from becoming authorization identifiers, and preserves existing system-role grant/final-owner semantics.

### Effective permissions

For tenant scope, authoritative permission loading becomes:

```text
system-role permissions
UNION
permissions from active custom-role assignments
```

A custom-role contribution is valid only when:

- membership is active;
- assignment is active (`revoked_at IS NULL`);
- custom role is active (`archived_at IS NULL`);
- role, assignment, and membership all belong to the current tenant;
- permission is a known code-seeded tenant permission.

The final `permissionKeys` list is de-duplicated and deterministically sorted before entering `AuthorizationContext`.

Unknown role identifiers, unknown permission identifiers, wrong-scope permissions, cross-tenant joins, or malformed rows fail closed rather than widening authority.

### Current-scope-only response

`GET /auth/me/authorization` remains current-scope-only and no-store. Sprint 2 does not expose custom-role management metadata through this endpoint. It reports the stable system `roleKeys` and effective `permissionKeys` for the current authoritative scope.

Custom-role definition and assignment metadata is available only through dedicated tenant RBAC management endpoints with their own permissions and resource policies.

## Authorization-Version Invalidation

`TenantMembership.authorizationVersion` remains the tenant authority epoch.

### Assignment grant

Inside one tenant transaction:

1. lock/validate active target membership;
2. lock/validate active custom role;
3. create the active assignment or detect an existing equivalent assignment;
4. if authority changed, increment target membership authorization version exactly once;
5. write tenant security audit event;
6. commit.

### Assignment revoke

Inside one tenant transaction:

1. lock the active assignment and target membership;
2. mark the assignment revoked;
3. increment target membership authorization version exactly once when authority changed;
4. write audit event;
5. commit.

A repeated revoke that makes no authority change does not bump the version again.

### Permission-set replace

The API accepts the complete desired permission-key set plus `expectedVersion` for the role.

Inside one tenant transaction:

1. lock the active role row;
2. verify `role.version == expectedVersion`;
3. validate the complete desired set against catalog/grant policy;
4. compute added and removed permissions;
5. if the effective set is unchanged, return success without role or membership version changes;
6. apply mapping additions/removals atomically;
7. increment `role.version` exactly once;
8. load active memberships holding the role using stable ordering;
9. increment each affected membership authorization version exactly once;
10. write one bounded audit event describing the role permission-set change;
11. commit.

A stale `expectedVersion` returns a conflict and makes no partial mutation.

### Name/description update

A metadata-only update does not alter effective authority and therefore does not bump membership authorization versions. The role row may update `updatedAt`, but its authority `version` remains unchanged unless the implementation chooses a separate metadata concurrency token. If one shared optimistic version is preferred during implementation planning, the plan must distinguish metadata concurrency from authority invalidation so membership versions still change only when authority changes.

### Archive

Inside one tenant transaction:

1. lock the active role;
2. reject stale expected version;
3. mark the role archived;
4. revoke every active assignment for that role;
5. increment the role authority version;
6. increment each affected active membership authorization version exactly once;
7. retain permission mappings and revoked assignments for historical/audit reconstruction;
8. write audit event;
9. commit.

Archived roles cannot be restored in Sprint 2. Reuse requires creating a new role with a new UUID.

## Concurrency Model

Concurrency behavior is part of the security contract.

### Lock ordering

Mutations must acquire locks in stable order to reduce deadlock risk:

1. custom role row when role state is involved;
2. affected memberships ordered by membership UUID;
3. active assignment rows ordered by assignment UUID when required.

Repository/application boundaries must make this ordering deterministic in tests.

### Required race outcomes

- concurrent create with the same normalized role name: exactly one succeeds;
- concurrent permission-set replace with the same expected version: at most one authority-changing mutation succeeds; later caller receives version conflict or converges as an idempotent no-op if desired set is already current;
- duplicate concurrent role grant: one active assignment exists and membership authority version increments once;
- concurrent revoke of the same assignment: assignment becomes revoked once and membership authority version increments once;
- archive racing assignment grant: commit must never leave a new active assignment pointing at an archived role;
- archive racing permission replace: one serialized final state wins; no partial mapping/assignment/version state is committed;
- cross-tenant resource IDs never widen the current transaction tenant.

## API Surface

All tenant RBAC routes execute only on the resolved tenant hostname under a valid tenant session and the existing CSRF/origin protections for unsafe methods.

Proposed routes:

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

Route naming may be adjusted during implementation planning only to align with existing API conventions; resource semantics and security boundaries in this design are normative.

### Create role

Input:

- `name`
- optional `description`
- optional initial delegable permission keys

Creation with an initial permission set is atomic. If any requested permission is invalid/non-delegable/not held by the actor, no role is created.

### Update role metadata

Input:

- `name` and/or `description`

Metadata update cannot change permission mappings.

### Replace role permissions

Input:

- `permissionKeys` — complete desired set
- `expectedVersion`

Using a complete desired set makes retries deterministic and prevents client/server drift from a sequence of partially successful grants/revokes. Audit still records bounded added/removed permission keys.

### Archive role

Input:

- `expectedVersion`

Archive is soft and irreversible in Sprint 2.

### Assignment routes

Assignment targets the membership resource, not a raw user ID. APIs never accept a tenant ID to select the authorization scope.

## Error Semantics

Domain/application errors use stable machine codes rather than database strings.

Required cases include:

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
MEMBERSHIP_REQUIRED
MEMBERSHIP_INACTIVE
```

Cross-tenant resource identifiers should map to the same safe not-found/denied semantics as same-tenant inaccessible resources and must not reveal whether the foreign resource exists.

Validation errors must not echo secrets or internal SQL/Prisma details.

## Audit and Observability

All authority-changing RBAC mutations write to the existing tenant security-audit path inside the same transaction as the authorization change.

Proposed bounded event types:

```text
tenant.rbac.role.created
tenant.rbac.role.updated
tenant.rbac.role.permissions_changed
tenant.rbac.role.archived
tenant.rbac.assignment.granted
tenant.rbac.assignment.revoked
```

Audit metadata may contain bounded identifiers and permission keys required for forensic reconstruction, for example:

- custom role UUID;
- target membership UUID for assignment changes;
- added/removed permission keys;
- prior/new role authority version.

Audit metadata must not include:

- session secrets;
- CSRF values;
- cookies;
- password/reset/activation/invitation secrets;
- raw authorization headers;
- user email solely for convenience;
- unbounded request bodies.

Metrics use low-cardinality labels only, for example operation/result/error-class. Tenant IDs, user IDs, membership IDs, role IDs, role names, and permission keys must not be metric labels.

## Security Invariants

The following invariants are production-blocking:

1. System roles remain immutable through tenant RBAC APIs.
2. Custom role names/UUIDs never become permission identifiers or system-role aliases.
3. Permission identifiers remain code-seeded and append-only.
4. Unknown permission strings fail closed.
5. Platform-scoped permissions cannot enter a tenant custom role.
6. Non-delegable permissions cannot enter a tenant custom role.
7. An actor cannot grant a permission they do not currently possess.
8. Tenant admins cannot mutate RBAC by default in Sprint 2.
9. Tenant RBAC routes cannot assign or revoke system roles.
10. Cross-tenant role, membership, assignment, and mapping access is denied by application policy and FORCE RLS.
11. Missing tenant execution context is denied by FORCE RLS.
12. Every authority-changing mutation bumps the correct membership authorization versions before commit.
13. Stale session authority is reconciled before protected application logic executes.
14. Role archive cannot leave active custom-role assignments.
15. Permission-set replacement cannot partially commit.
16. Audit write and authority mutation succeed or roll back together.
17. `AuthorizationContext.roleKeys` remains system-role-only.
18. Effective permission output is de-duplicated, deterministic, current-scope-only, and no-store.
19. Unsafe browser mutations require existing same-origin and CSRF protections.
20. No RBAC endpoint accepts client-supplied tenant identity as authority context.

## Testing Strategy

Sprint 2 follows RED -> GREEN -> REFACTOR and introduces focused unit, integration, RLS, concurrency, API E2E, contract, architecture, and acceptance coverage.

### Unit coverage

- role-name normalization and validation;
- permission catalog metadata/delegability;
- owner-governed grant policy;
- actor-cannot-grant-more-than-self matrix;
- permission-set diff behavior;
- archive rules;
- idempotent assignment/revoke decisions;
- stable error mapping.

### Persistence and RLS coverage

- custom-role schema constraints;
- active-name partial uniqueness;
- same-tenant composite ownership constraints;
- permission scope enforcement;
- FORCE RLS read/write/update/delete denial across tenants;
- missing `app.tenant_id` denial;
- policy-manifest and migration-verifier coverage.

### Concurrency coverage

- duplicate role-name creation;
- concurrent permission-set replace;
- duplicate assignment grant;
- duplicate assignment revoke;
- archive vs assignment grant;
- archive vs permission replace;
- membership version increments exactly once per real authority change.

### Authorization E2E coverage

- owner mutation success;
- tenant-admin read-only success and mutation denial;
- cross-tenant resource-ID denial;
- custom role adds an effective permission without appearing in `roleKeys`;
- assignment revoke removes the effective permission after stale-authority reconciliation;
- permission-set change invalidates every active holder session snapshot through membership version mismatch;
- archived role contributes no permission;
- `/auth/me/authorization` remains no-store/current-scope-only.

## Sprint 2 Acceptance Matrix

The implementation plan must produce named evidence for at least the following cases:

- `S2-RBAC01` tenant owner creates and reads a custom role in the current tenant.
- `S2-RBAC02` duplicate active normalized role name is rejected in one tenant while the same name is allowed in another tenant.
- `S2-RBAC03` tenant admin can read RBAC state but cannot create/update/archive roles or mutate mappings/assignments.
- `S2-RBAC04` tenant RBAC APIs cannot mutate seeded system roles.
- `S2-RBAC05` unknown, platform-scoped, or non-delegable permission keys are rejected atomically.
- `S2-RBAC06` owner cannot grant a delegable permission that is absent from the owner's current authoritative permission set.
- `S2-RBAC07` atomic permission-set replace changes role authority version once and bumps every active holder membership version once.
- `S2-RBAC08` stale expected role version causes conflict with no partial permission or membership-version change.
- `S2-RBAC09` grant/revoke custom role targets only active same-tenant membership and bumps its authority version once per real change.
- `S2-RBAC10` duplicate concurrent grant/revoke converges to one active/revoked state without duplicate version increments.
- `S2-RBAC11` role archive revokes active assignments, bumps affected active memberships, and blocks future assignment.
- `S2-RBAC12` cross-tenant and missing-context persistence paths are denied by FORCE RLS even when resource UUIDs are known.
- `S2-RBAC13` custom-role authority contributes only effective permissions; `AuthorizationContext.roleKeys` remains system-role-only.
- `S2-RBAC14` stale session authority is rejected/reconciled before a newly revoked permission can execute a protected use case.
- `S2-RBAC15` RBAC audit events are transactional, bounded, and secret-safe.
- `S2-RBAC16` all existing Sprint 1B identity/session/membership/authorization acceptance and protected CI gates remain green.

## CI and Verification

Sprint 2 adds a dedicated repository command such as:

```text
pnpm verify:dynamic-rbac
```

The exact script name is finalized in the implementation plan, but the dedicated gate must cover the Sprint 2 acceptance matrix and must be invoked by the repository's protected Foundation/CI path before Sprint 2 closeout.

Closeout verification must include at minimum:

- focused auth/contracts unit tests;
- authorization module unit tests;
- Prisma migration verification;
- tenant FORCE-RLS integration tests;
- RBAC concurrency E2E;
- OpenAPI compatibility;
- architecture-boundary verification;
- Sprint 1B identity-access acceptance regression;
- build;
- browser/Foundation smoke where the existing protected workflow requires it;
- dependency audit and committed-secret scan.

No Sprint 2 completion claim is valid from focused tests alone.

## Rollout and Rollback

Migration is additive:

- add three tenant custom-RBAC tables;
- add constraints/indexes/RLS policies;
- append Sprint 2 permission catalog seeds and system-role mappings;
- leave existing system-role tables and assignments intact;
- existing tenants start with zero custom roles and no custom assignments.

This means deployment before role creation does not change existing effective authority except for newly seeded RBAC management/read permissions assigned to system roles.

Permission seed/mapping changes and schema migration must be transactionally/migration-order safe so application code never assumes a permission row that is absent.

Rollback posture is forward-fix rather than destructive down-migration once production has created custom roles or assignments. Operational rollback may disable RBAC mutation routes while retaining tables and authorization reads. Deleting tenant RBAC history is not an acceptable rollback mechanism.

## Documentation and Ownership Closeout

Sprint 2 closeout must update, where applicable:

- active feature documentation for dynamic tenant RBAC;
- authorization pattern documentation;
- architecture/deployment baseline if module responsibilities change materially;
- domain ownership registry if a new bounded domain name is introduced;
- operational recovery/runbook guidance for accidental role/permission assignment;
- 90-day execution status;
- Pilot/Go-No-Go checkpoint evidence.

The closeout documentation must describe how to inspect and safely recover from:

- accidental custom-role assignment;
- accidental permission-set expansion;
- archived role impact;
- stale authority/session reconciliation;
- RBAC mutation outage while read authorization remains available.

## Design Alternatives Considered

### Alternative A — Reuse global `Role` for custom tenant roles

This would add tenant ownership to the existing global role model and make `Role.key` semantics conditional on scope/system state. It reduces table count but creates difficult migration, uniqueness, RLS, and contract questions because existing roles are globally keyed system roles and current authorization contracts treat known role keys as a closed system-role set.

Rejected for Sprint 2 because it increases regression risk around final-owner logic, `AuthorizationContext.roleKeys`, seeding, and global-vs-tenant role identity.

### Alternative B — Separate tenant custom-role aggregate

Chosen.

It keeps system governance roles stable, gives custom RBAC an explicit tenant-owned RLS boundary, uses UUID identity instead of editable role names, and lets effective permissions expand without breaking the existing role-key contract.

The cost is three additional tables and an explicit permission-union query, which is acceptable for the stronger isolation and migration clarity.

### Alternative C — Fully delegated RBAC administration in Sprint 2

This would allow custom roles to receive RBAC mutation permissions and create nested delegation policies.

Deferred. It materially expands privilege-escalation, recursive grant, concurrency, recovery, and UX complexity before the Phase 2 Role Builder is scheduled. Sprint 2 instead uses owner-governed mutation and explicit non-delegable RBAC capabilities while keeping catalog metadata extensible for a later reviewed delegation model.

## Completion Criteria

Sprint 2 design intent is satisfied only when implementation evidence proves all of the following:

- tenant custom roles are tenant-owned, UUID-identified, FORCE-RLS protected, and separate from system roles;
- Permission Catalog V2 remains code-seeded/append-only and rejects arbitrary permission strings;
- owner-governed, non-self-delegating grant policy prevents privilege escalation;
- custom role permission mappings and membership assignments are safe under concurrency;
- every authority change invalidates the correct membership authorization versions atomically;
- effective authorization unions custom-role permissions without widening `AuthorizationContext.roleKeys`;
- stale authority cannot execute protected logic;
- audit/metrics remain transactional and secret-safe;
- cross-tenant isolation passes application and database tests;
- Sprint 1B protected regressions and repository security/architecture gates remain green;
- full Role Builder UI remains out of Sprint 2 scope.
