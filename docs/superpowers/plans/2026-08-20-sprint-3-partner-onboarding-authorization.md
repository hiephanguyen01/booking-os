# Sprint 3A Partner Onboarding & Authorization Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first Partner vertical slice: tenant-host Partner registration, one-email identity verification, Partner review/approval, first-class Partner authorization/session scope, multi-member Partner governance, minimum web-console UX, and executable `S3-PARTNER01`–`S3-PARTNER20` protected evidence.

**Architecture:** Add a dedicated hexagonal `PartnerModule` while extending, not replacing, the shared Sprint 1B/Sprint 2 identity/session/authorization kernel. Partner-owned rows remain tenant-owned and FORCE-RLS protected; Partner scope is an authoritative application/session boundary, while PostgreSQL RLS remains the hard cross-tenant boundary. Catalog remains out of scope and consumes only the exported `PartnerEligibilityPort`.

**Tech Stack:** Node.js 22, pnpm 10.34.5, TypeScript 5.9.3, NestJS, Prisma, PostgreSQL 17, Redis 7, Next.js web-console, Playwright, Node test runner, OpenAPI code generation, Biome, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-20-sprint-3-partner-onboarding-authorization-design.md`  
Approved spec baseline before repository write: local artifact produced 2026-08-20; implementation baseline is repository head `5fdb8215123400a9d59796f407878d92891261fb`.

## Global Constraints

- Reuse the global User, password credential, opaque host-only session, CSRF/origin, one-time-token, authorization-version, audit, and FORCE-RLS kernel; do not create a parallel Partner auth system.
- Partner is a true third authorization/session scope: `platform | tenant | partner`.
- Partner users are not represented as tenant staff through `TenantMembership`.
- `PartnerMembership.authorizationVersion` is the Partner authority epoch.
- System roles are immutable. Sprint 3A adds only `partner_owner` and `partner_member`; Partner custom roles remain out of scope.
- Permission Catalog V2 remains code-seeded and append-only. Add only the tenant/Partner permission keys required by this slice.
- New-user Partner onboarding sends one message; Partner registration/verification artifacts never authenticate by themselves.
- Email verification does not imply marketplace approval.
- Only `Partner.status === "active"` is inventory-eligible.
- All Partner-owned persistence carries `tenant_id` directly and uses FORCE RLS with canonical `app.tenant_id`.
- Do not add `app.partner_id` to PostgreSQL RLS in Sprint 3A.
- Partner self routes derive `partnerId` from authoritative Partner scope; do not accept client `tenantId`, and do not accept self-route `partnerId`.
- Public registration is same-origin, rate-limited, enumeration-safe, normalized-email, and secret-safe.
- Raw activation/verification/invitation/session secrets never enter query strings, logs, audit metadata, browser storage, analytics, or server-rendered HTML.
- Controllers invoke use cases and map stable errors; controllers do not query Prisma.
- Cross-module dependencies use exported application contracts only; do not import another module's `infrastructure/`.
- Application transaction callbacks receive capability ports, never `Prisma.TransactionClient`.
- Supported API remains code-first OpenAPI; generated OpenAPI/client files are regenerated and committed, never manually authored.
- Every authority-changing Partner mutation writes required history/audit/outbox and bumps affected authority versions in the same transaction.
- Preserve Sprint 1B identity-access and Sprint 2 dynamic-RBAC protected behavior.
- No Listing, Resource, Availability, Pricing, Booking, Payment, Finance, automated eKYC, social login, or Partner custom Role Builder work in this plan.

## File Structure Lock

New Partner module:

```text
apps/api/src/modules/partner/
├── domain/
│   ├── partner.ts
│   ├── partner-membership.ts
│   ├── partner-review.ts
│   ├── partner-verification.ts
│   ├── partner-eligibility.ts
│   └── partner.errors.ts
├── application/
│   ├── ports/
│   │   ├── partner-repository.port.ts
│   │   ├── partner-membership-repository.port.ts
│   │   ├── partner-review-repository.port.ts
│   │   ├── partner-registration-verification.port.ts
│   │   ├── partner-data-session.ts
│   │   ├── partner-transaction.port.ts
│   │   ├── partner-identity.port.ts
│   │   ├── partner-email-outbox.port.ts
│   │   └── partner-eligibility.port.ts
│   └── use-cases/
│       ├── register-partner.use-case.ts
│       ├── verify-partner-registration.use-case.ts
│       ├── update-partner-profile.use-case.ts
│       ├── submit-partner-review.use-case.ts
│       ├── list-tenant-partners.use-case.ts
│       ├── get-tenant-partner.use-case.ts
│       ├── request-partner-changes.use-case.ts
│       ├── approve-partner.use-case.ts
│       ├── reject-partner.use-case.ts
│       ├── suspend-partner.use-case.ts
│       ├── list-partner-memberships.use-case.ts
│       ├── invite-partner-member.use-case.ts
│       ├── accept-partner-membership.use-case.ts
│       ├── revoke-partner-membership.use-case.ts
│       └── select-partner-scope.use-case.ts
├── infrastructure/
│   ├── http/
│   │   ├── partner-public.controller.ts
│   │   ├── tenant-partners.controller.ts
│   │   ├── partner-workspace.controller.ts
│   │   ├── partner.dto.ts
│   │   └── partner-http-errors.ts
│   └── persistence/prisma/
│       ├── prisma-partner-repository.adapter.ts
│       ├── prisma-partner-membership-repository.adapter.ts
│       ├── prisma-partner-review-repository.adapter.ts
│       └── prisma-partner-registration-verification.adapter.ts
├── partner.module.ts
└── partner.tokens.ts
```

Shared files are modified only where their existing ownership requires Partner-scope extension.

---

### Task 1: Extend the code-owned authorization vocabulary for Partner scope

**Execution correction — 2026-08-20 source audit**

- `packages/auth/src/authorization.ts` is the exhaustive runtime `Record<SystemRole, ...>` mapping and is part of Task 1. Adding Partner system roles without updating this file makes the runtime/type contract incomplete.
- `packages/auth/src/index.ts` already exports the authorization, permission-catalog, permission, and role modules needed by this task; no Task 1 edit is required.
- `packages/contracts/src/index.ts` already re-exports `./auth/index.js`; no Task 1 edit is required.
- `packages/contracts/src/request-context.ts` owns tenant execution/transaction authority and remains deferred to Task 7. Task 1 only extends the API authenticated request-context scope/guards.
- Existing closed-catalog tests are updated in place rather than duplicated into a new Partner-only vocabulary test.

**Files:**
- Modify: `packages/auth/src/roles.ts`
- Modify: `packages/auth/src/permissions.ts`
- Modify: `packages/auth/src/permission-catalog.ts`
- Modify: `packages/auth/src/authorization.ts`
- Modify: `packages/auth/tests/authorization.test.ts`
- Modify: `packages/auth/tests/permission-catalog.test.ts`
- Modify: `packages/contracts/src/auth/authorization-context.ts`
- Modify: `packages/contracts/src/auth/index.ts`
- Modify: `packages/contracts/tests/authorization-context.test.ts`
- Modify: `apps/api/src/common/request-context/request-context.types.ts`
- Create: `apps/api/src/common/request-context/request-context.types.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type AuthorizationRoleKey =
    | "platform_admin"
    | "tenant_owner"
    | "tenant_admin"
    | "partner_owner"
    | "partner_member";

  type PartnerAuthorizationScope = {
    readonly type: "partner";
    readonly tenantId: string;
    readonly tenantSlug: string;
    readonly partnerId: string;
  };

  type ActivePartnerAuthorizationContext = AuthorizationContext & {
    readonly scope: PartnerAuthorizationScope;
    readonly membershipId: string;
    readonly membershipStatus: "active";
    readonly membershipAuthorizationVersion: number;
  };
  ```
- Produces `PermissionCatalogEntry.scopeLevel: "platform" | "tenant" | "partner"`.
- Produces exact runtime role-permission mappings for tenant Partner-management roles and the two Partner system roles.

- [ ] **Step 1: Write RED tests for exact Partner roles, permissions, runtime mappings, scope levels, and request-context guards**

Update the existing closed auth catalogs first:

```ts
assert.equal(SYSTEM_ROLES.partnerOwner, "partner_owner");
assert.equal(SYSTEM_ROLES.partnerMember, "partner_member");

assert.deepEqual(
  [
    PERMISSION_KEYS.tenantPartnerRead,
    PERMISSION_KEYS.tenantPartnerReview,
    PERMISSION_KEYS.tenantPartnerApprove,
    PERMISSION_KEYS.tenantPartnerSuspend,
  ],
  [
    "tenant.partner.read",
    "tenant.partner.review",
    "tenant.partner.approve",
    "tenant.partner.suspend",
  ],
);

assert.equal(getPermissionCatalogEntry(PERMISSION_KEYS.partnerProfileRead)?.scopeLevel, "partner");
assert.equal(getPermissionCatalogEntry(PERMISSION_KEYS.partnerMembershipInvite)?.scopeLevel, "partner");
```

Add runtime mapping expectations:

```ts
assert.deepEqual(getPermissions(SYSTEM_ROLES.partnerOwner), [
  PERMISSION_KEYS.partnerProfileRead,
  PERMISSION_KEYS.partnerProfileUpdate,
  PERMISSION_KEYS.partnerMembershipRead,
  PERMISSION_KEYS.partnerMembershipInvite,
  PERMISSION_KEYS.partnerMembershipRevoke,
]);

assert.deepEqual(getPermissions(SYSTEM_ROLES.partnerMember), [
  PERMISSION_KEYS.partnerProfileRead,
  PERMISSION_KEYS.partnerMembershipRead,
]);
```

Add contract and request-context expectations proving:
- `AuthorizationContext.scope` accepts exact Partner `tenantId + tenantSlug + partnerId`;
- `ActivePartnerAuthorizationContext` requires active membership + positive membership authorization version;
- authenticated Partner request scope requires non-empty `tenantId` and `partnerId`;
- Partner request scope is authorization-ready only when session state is active and membership authorization version is positive.

Partner permission constants are exactly:

```ts
tenantPartnerRead: "tenant.partner.read",
tenantPartnerReview: "tenant.partner.review",
tenantPartnerApprove: "tenant.partner.approve",
tenantPartnerSuspend: "tenant.partner.suspend",
partnerProfileRead: "partner.profile.read",
partnerProfileUpdate: "partner.profile.update",
partnerMembershipRead: "partner.membership.read",
partnerMembershipInvite: "partner.membership.invite",
partnerMembershipRevoke: "partner.membership.revoke",
```

Use catalog metadata:
- tenant Partner-management permissions: tenant-scoped and delegable;
- Partner permissions: partner-scoped and non-delegable in Sprint 3A because Partner custom RBAC does not yet exist.

- [ ] **Step 2: Run RED vocabulary/contract/guard tests**

Run:

```bash
pnpm --filter @booking-os/auth test
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/api test -- request-context
```

Expected: FAIL because Partner roles, Partner permissions, Partner runtime mappings, Partner authorization-context types, and Partner request guards do not exist.

- [ ] **Step 3: Implement minimal vocabulary, runtime role mappings, and contract extension**

Add to `SYSTEM_ROLES`:

```ts
partnerOwner: "partner_owner",
partnerMember: "partner_member",
```

Extend `PermissionCatalogEntry.scopeLevel`:

```ts
readonly scopeLevel: "platform" | "tenant" | "partner";
```

Extend `ROLE_PERMISSIONS` exactly:

```text
tenant_owner
tenant_admin
  + tenant.partner.read
  + tenant.partner.review
  + tenant.partner.approve
  + tenant.partner.suspend

partner_owner
  partner.profile.read
  partner.profile.update
  partner.membership.read
  partner.membership.invite
  partner.membership.revoke

partner_member
  partner.profile.read
  partner.membership.read
```

Extend authorization context:

```ts
readonly scope:
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string; readonly tenantSlug: string }
  | {
      readonly type: "partner";
      readonly tenantId: string;
      readonly tenantSlug: string;
      readonly partnerId: string;
    };
```

Export `ActivePartnerAuthorizationContext` from `packages/contracts/src/auth/index.ts`.

Do not edit `packages/contracts/src/request-context.ts` in this task; transaction/execution authority is Task 7.

- [ ] **Step 4: Add Partner-aware API request-context scope and guards**

Extend:

```ts
export type AuthenticatedScope =
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string }
  | { readonly type: "partner"; readonly tenantId: string; readonly partnerId: string };
```

`isAuthenticatedRequestContext()` accepts Partner scope only when both `tenantId` and `partnerId` are non-empty strings.

`AuthorizationReadyRequestContext` accepts Partner scope only with:
- session state `active`;
- positive `membershipAuthorizationVersion`.

Keep `RequestContext.tenantId` as the canonical tenant execution key; do not add client-derived Partner authority to base execution contracts here.

- [ ] **Step 5: Run GREEN focused and repository type verification**

```bash
pnpm --filter @booking-os/auth test
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/api test -- request-context
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  packages/auth/src/roles.ts \
  packages/auth/src/permissions.ts \
  packages/auth/src/permission-catalog.ts \
  packages/auth/src/authorization.ts \
  packages/auth/tests/authorization.test.ts \
  packages/auth/tests/permission-catalog.test.ts \
  packages/contracts/src/auth/authorization-context.ts \
  packages/contracts/src/auth/index.ts \
  packages/contracts/tests/authorization-context.test.ts \
  apps/api/src/common/request-context/request-context.types.ts \
  apps/api/src/common/request-context/request-context.types.test.ts

git commit -m "feat: define Partner authorization scope"
```

---

### Task 2: Add Partner persistence, system-role seed data, and FORCE-RLS migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260820160000_partner_onboarding_authorization/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Test: `apps/api/test/partner-persistence.e2e.test.ts`
- Test: `apps/api/test/tenant-isolation.e2e.test.ts` only to append Partner-table matrix coverage
- Modify migration verification fixtures/registries only if the current verifier requires explicit table registration

**Interfaces:**
- Produces Prisma models:
  `Partner`, `PartnerMembership`, `PartnerMembershipInvitation`,
  `PartnerRegistrationVerification`, `PartnerVerificationCheck`,
  `PartnerPayoutAccount`, `PartnerReviewDecision`, `PartnerLifecycleHistory`.
- Extends `IdentityScopeType` and `RoleScopeLevel` with `partner`.
- Extends `AuthSession` and `AuthSessionToken` with nullable `partnerId`.
- Extends `RoleAssignment` with nullable `partnerId`.

- [ ] **Step 1: Write RED PostgreSQL persistence/RLS acceptance**

Create named tests for:
- same email may own Partner records in two tenants;
- same `(partner_id, user_id)` membership cannot duplicate;
- cross-tenant PartnerMembership FK fails;
- Partner verification/review/history rows cannot reference a Partner in another tenant;
- `booking_app` with tenant A context cannot read/write tenant B Partner rows;
- missing `app.tenant_id` fails closed;
- role assignment scope constraints reject invalid platform/tenant/partner combinations;
- auth-session scope constraints reject `partner` without both tenant and Partner IDs.

Representative assertion:

```ts
await expect(
  tenantBAppClient.query(
    `SELECT id FROM partners WHERE tenant_id = $1::uuid`,
    [tenantAId],
  ),
).resolves.toMatchObject({ rowCount: 0 });
```

- [ ] **Step 2: Run RED migration/persistence tests**

```bash
pnpm --filter @booking-os/api prisma:validate
pnpm --filter @booking-os/api test:e2e -- partner-persistence.e2e.test.ts
```

Expected: FAIL because Partner schema/tables/enums do not exist.

- [ ] **Step 3: Extend Prisma enums and scope-bearing records**

Add:

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

enum PartnerType {
  individual
  company
}

enum PartnerStatus {
  draft
  pendingReview @map("pending_review")
  active
  inactive
  suspended
  cancelled
}

enum PartnerMembershipStatus {
  invited
  active
  suspended
  revoked
}
```

Add nullable `partnerId` to `AuthSession`, `AuthSessionToken`, and `RoleAssignment`, with Partner relation/indexes.

- [ ] **Step 4: Create Partner models with direct `tenant_id` and composite integrity**

Use explicit same-tenant unique keys such as:

```prisma
@@unique([id, tenantId])
```

on `Partner`, and bind dependent rows with composite `(partnerId, tenantId)` relations.

`PartnerMembership` includes:

```prisma
authorizationVersion Int @default(1) @map("authorization_version")
@@unique([partnerId, userId])
@@unique([id, tenantId, partnerId])
```

`PartnerReviewDecision.outcome` is `changes_requested | approved | rejected`; rejection/change request history is immutable rather than represented by a long-lived `rejected` Partner status.

- [ ] **Step 5: Implement SQL constraints and FORCE RLS**

Migration must:
1. add Partner enum values/types;
2. create tables;
3. add composite FKs;
4. add scope-shape `CHECK` constraints for role assignments/sessions;
5. `ENABLE ROW LEVEL SECURITY`;
6. `FORCE ROW LEVEL SECURITY`;
7. create `USING/WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)` policies;
8. grant only required CRUD to `booking_app`;
9. preserve global code-seeded role/permission tables as non-tenant-owned reference data.

Do not introduce `app.partner_id`.

- [ ] **Step 6: Seed system roles and exact permission mappings**

Seed:
- `partner_owner`
- `partner_member`
- all 9 Sprint 3A permission keys.

Exact system-role mapping:

```text
tenant_owner:
  tenant.partner.read
  tenant.partner.review
  tenant.partner.approve
  tenant.partner.suspend

tenant_admin:
  tenant.partner.read
  tenant.partner.review
  tenant.partner.approve
  tenant.partner.suspend

partner_owner:
  partner.profile.read
  partner.profile.update
  partner.membership.read
  partner.membership.invite
  partner.membership.revoke

partner_member:
  partner.profile.read
  partner.membership.read
```

- [ ] **Step 7: Run GREEN migration/RLS verification**

```bash
pnpm --filter @booking-os/api prisma:generate
pnpm --filter @booking-os/api prisma:validate
pnpm --filter @booking-os/api test:e2e -- partner-persistence.e2e.test.ts tenant-isolation.e2e.test.ts
pnpm verify:migrations
```

Expected: PASS with zero schema drift.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/test/partner-persistence.e2e.test.ts apps/api/test/tenant-isolation.e2e.test.ts
git commit -m "feat: persist tenant-owned Partners"
```

---

### Task 3: Establish Partner domain, ports, transaction capabilities, and Prisma adapters

**Files:**
- Create all `apps/api/src/modules/partner/domain/*`
- Create all repository/data-session/transaction ports under `apps/api/src/modules/partner/application/ports/`
- Create: `apps/api/src/modules/partner/infrastructure/persistence/prisma/prisma-partner-repository.adapter.ts`
- Create: `.../prisma-partner-membership-repository.adapter.ts`
- Create: `.../prisma-partner-review-repository.adapter.ts`
- Create: `.../prisma-partner-registration-verification.adapter.ts`
- Create adapter tests beside each adapter
- Modify: `apps/api/src/modules/tenancy/application/ports/tenant-transaction.port.ts`
- Modify: `apps/api/src/database/prisma-tenant-data-session.factory.ts`
- Modify: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.ts` only to compose Partner capabilities; Partner authority validation is Task 6
- Create: `apps/api/src/modules/partner/partner.tokens.ts`
- Create: `apps/api/src/modules/partner/partner.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces:

```ts
export interface PartnerDataSession {
  readonly partners: PartnerRepositoryPort;
  readonly memberships: PartnerMembershipRepositoryPort;
  readonly reviews: PartnerReviewRepositoryPort;
  readonly registrationVerifications: PartnerRegistrationVerificationPort;
}

export interface PartnerTransactionPort {
  run<T>(
    context: TenantExecutionContext | AuthorizedTenantExecutionContext,
    work: (session: PartnerDataSession) => Promise<T>,
  ): Promise<T>;
}

export interface PartnerEligibilityPort {
  canCreateInventory(input: {
    readonly tenantId: string;
    readonly partnerId: string;
  }): Promise<boolean>;
}
```

- [ ] **Step 1: Write RED domain tests**

Cover:
- allowed lifecycle transitions;
- required checklist by `individual/company`;
- `active` is the only inventory-eligible state;
- invalid display/legal names are rejected;
- version must be positive;
- final-owner policy reports when a revoke would orphan Partner governance.

- [ ] **Step 2: Run RED domain tests**

```bash
pnpm --filter @booking-os/api test -- partner
```

Expected: FAIL because Partner domain does not exist.

- [ ] **Step 3: Implement domain types/policies/errors**

Use explicit domain errors:

```ts
PartnerNotFoundError
PartnerStateConflictError
PartnerVersionConflictError
PartnerReviewRequirementsIncompleteError
PartnerMembershipNotFoundError
PartnerMembershipLastOwnerError
PartnerAccessDeniedError
PartnerRegistrationVerificationInvalidError
```

Each exposes a stable machine `code`; no infrastructure detail is embedded.

- [ ] **Step 4: Write RED Prisma adapter tests**

Test transaction-bound CRUD, lock/read methods, membership version increment, review-decision append, and Partner history append under tenant context.

- [ ] **Step 5: Implement focused Prisma adapters**

Adapters accept a transaction-scoped Prisma client internally but implement Partner-owned application ports only.

Required repository operations include exact methods such as:

```ts
findById(partnerId: string): Promise<PartnerRecord | null>;
lockById(partnerId: string): Promise<PartnerRecord | null>;
create(input: CreatePartnerRecord): Promise<PartnerRecord>;
updateProfile(input: UpdatePartnerProfileRecord): Promise<PartnerRecord>;
transition(input: PartnerTransitionRecord): Promise<PartnerRecord>;
```

Membership port includes:

```ts
findActiveForUser(partnerId: string, userId: string): Promise<PartnerMembershipRecord | null>;
lockActiveOwners(partnerId: string): Promise<readonly PartnerMembershipRecord[]>;
incrementAuthorizationVersion(membershipId: string): Promise<number>;
listActiveByPartner(partnerId: string): Promise<readonly PartnerMembershipRecord[]>;
```

- [ ] **Step 6: Compose Partner capabilities into tenant transaction session**

`PrismaTenantDataSessionFactory.create(transaction, tenantId)` exposes a focused `partner` capability group. Do not expose Prisma itself.

- [ ] **Step 7: Register `PartnerModule` without HTTP controllers yet**

Import Partner module in `AppModule`; module exports only application contracts needed by Sessions/Authorization/future Catalog.

- [ ] **Step 8: Run GREEN architecture/unit/adapter tests**

```bash
pnpm --filter @booking-os/api test -- partner prisma-partner
pnpm verify:architecture
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/partner apps/api/src/modules/tenancy apps/api/src/database/prisma-tenant-data-session.factory.ts apps/api/src/app.module.ts
git commit -m "feat: add Partner domain boundary"
```

---

### Task 4: Implement Partner registration, verification artifacts, and one-email onboarding orchestration

**Files:**
- Create: `partner/application/use-cases/register-partner.use-case.ts`
- Create: `partner/application/use-cases/register-partner.use-case.test.ts`
- Create: `partner/application/use-cases/verify-partner-registration.use-case.ts`
- Create test beside it
- Create: `partner/application/ports/partner-identity.port.ts`
- Create: `partner/application/ports/partner-email-outbox.port.ts`
- Create identity adapter under `partner/infrastructure/identity/` that calls exported Identity application contracts; do not import Identity infrastructure
- Modify Identity exported application API only if no existing create/find/activation capability can satisfy Partner onboarding
- Modify sensitive-envelope/outbox application contract only through existing encrypted-envelope primitives
- Test: `apps/api/test/partner-registration.e2e.test.ts`

**Interfaces:**
- `RegisterPartnerUseCase.execute()` accepts tenant/hostname from trusted request context, normalized registration fields, requestId, and now.
- Public response is enumeration-safe:
  ```ts
  { readonly accepted: true }
  ```
- New-user path creates one encrypted Partner-onboarding email event.
- Existing-user path creates one Partner-verification event.

- [ ] **Step 1: Write RED use-case tests for S3-PARTNER01–S3-PARTNER08**

Tests must explicitly prove:
- new user;
- existing active user;
- same-tenant duplicate convergence;
- same email in two tenants;
- one-time hash-only token storage;
- exact host/tenant/user/Partner binding;
- one-email new-user behavior;
- verified identity still leaves Partner non-active.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter @booking-os/api test -- register-partner verify-partner-registration
pnpm --filter @booking-os/api test:e2e -- partner-registration.e2e.test.ts
```

Expected: FAIL because use cases and token records do not exist.

- [ ] **Step 3: Implement registration transaction**

Within tenant transaction:

```text
normalize email
resolve/create global identity through Identity application port
create Partner(draft)
create PartnerMembership(invited, owner intent)
create hash-only PartnerRegistrationVerification
create Partner lifecycle history
append partner.registration.created audit/outbox
append exactly one email event
commit
```

Use a database uniqueness key/idempotency rule so two same-tenant/email registrations do not create duplicate active drafts.

- [ ] **Step 4: Implement exact verification semantics**

Verification:
- parses selector/secret using shared one-time-token primitives;
- locks verification row;
- checks hostname, tenant, Partner, user, purpose, expiry, revoked/consumed;
- constant-time verifies digest;
- consumes once;
- activates PartnerMembership only after required identity authentication/activation continuation is complete;
- appends `partner.registration.email_verified`;
- never changes Partner to `active`.

- [ ] **Step 5: Implement new-user single-email continuation**

Reuse shared activation/token primitives and encrypted sensitive envelope.

Material shape:

```ts
type PartnerOwnerOnboardingMaterial = {
  readonly activationToken: string;
  readonly partnerVerificationToken: string;
};
```

No plaintext secret may be stored in outbox payload JSON outside the encrypted envelope.

- [ ] **Step 6: Run GREEN registration tests**

```bash
pnpm --filter @booking-os/api test -- register-partner verify-partner-registration
pnpm --filter @booking-os/api test:e2e -- partner-registration.e2e.test.ts
pnpm verify:identity-access
```

Expected: PASS; Sprint 1B identity behavior unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/partner apps/api/src/modules/identity apps/api/test/partner-registration.e2e.test.ts
git commit -m "feat: register and verify Partners"
```

---

### Task 5: Extend the critical email worker for Partner onboarding and member invitations

**Files:**
- Modify: `apps/worker-critical/src/identity-email/identity-email-event.ts`
- Modify: `apps/worker-critical/src/identity-email/identity-email-dispatcher.ts`
- Modify: `apps/worker-critical/src/identity-email/sensitive-envelope.ts`
- Create: `apps/worker-critical/src/identity-email/partner-onboarding-email.test.ts`
- Create: `apps/worker-critical/src/identity-email/partner-member-invitation-email.test.ts`
- Modify: `apps/worker-critical/integration/mailpit-identity-email.integration.test.ts`
- Modify worker event registration if event-name allowlists live elsewhere

**Interfaces:**
- Adds event names:
  ```ts
  "partner.owner_onboarding.requested.v1"
  "partner.registration_verification.requested.v1"
  "partner.member_invitation.requested.v1"
  ```
- Adds templates:
  `partner_owner_onboarding`, `partner_registration_verification`, `partner_member_invitation`.

- [ ] **Step 1: Write RED parser/dispatcher tests**

Assert:
- exact aggregate type/tenant/Partner/user binding;
- invalid hostname/email/envelope rejected;
- Partner IDs never inferred from arbitrary payload fields when envelope metadata disagrees;
- message URL uses fragment, never query string;
- raw token absent from structured logs/test-safe event output.

- [ ] **Step 2: Run RED worker tests**

```bash
pnpm --filter @booking-os/worker-critical test -- identity-email
```

Expected: FAIL because Partner events/templates are unsupported.

- [ ] **Step 3: Extend encrypted-material parser**

Keep existing `IdentityEmailEnvelope` version 1 unless schema compatibility requires a new version. Add typed decrypted material unions; do not weaken existing owner-onboarding parsing.

- [ ] **Step 4: Render Partner messages**

New-user Partner owner link:

```text
https://<hostname>/partner/verify#activation=<ACTIVATION>&verification=<PARTNER_VERIFICATION>
```

Existing-user Partner verification link:

```text
https://<hostname>/partner/verify#token=<PARTNER_VERIFICATION>
```

Partner member invitation:

```text
https://<hostname>/partner/invite/accept#token=<INVITATION>
```

The browser consumes and strips fragment values before submission.

- [ ] **Step 5: Run GREEN worker + Mailpit tests**

```bash
pnpm --filter @booking-os/worker-critical test
pnpm --filter @booking-os/worker-critical test:integration
```

Expected: PASS; existing activation/password-reset/tenant-invitation templates remain green.

- [ ] **Step 6: Commit**

```bash
git add apps/worker-critical
git commit -m "feat: deliver Partner onboarding emails"
```

---

### Task 6: Extend opaque sessions and request authentication for stored Partner scope

**Files:**
- Modify: `apps/api/src/modules/sessions/domain/auth-session.ts`
- Modify: `apps/api/src/modules/sessions/application/ports/session-repository.port.ts`
- Modify: `apps/api/src/modules/sessions/application/use-cases/create-session.ts`
- Modify: `apps/api/src/modules/sessions/application/use-cases/get-current-session.use-case.ts`
- Modify: `apps/api/src/modules/sessions/application/use-cases/validate-session.ts`
- Modify corresponding unit tests
- Modify: `apps/api/src/modules/sessions/infrastructure/persistence/prisma/prisma-session-repository.adapter.ts`
- Modify adapter tests
- Modify: `apps/api/src/modules/sessions/infrastructure/http/session-auth.middleware.ts`
- Modify middleware tests
- Create: `apps/api/src/modules/partner/application/use-cases/select-partner-scope.use-case.ts`
- Create test beside it
- Test: `apps/api/test/partner-session-scope.e2e.test.ts`

**Interfaces:**
- `SessionScope` becomes:
  ```ts
  type SessionScope =
    | { readonly type: "platform" }
    | { readonly type: "tenant"; readonly tenantId: string }
    | { readonly type: "partner"; readonly tenantId: string; readonly partnerId: string };
  ```
- Introduce lookup boundary separate from stored scope:
  ```ts
  type SessionLookupBoundary =
    | { readonly type: "platform" }
    | { readonly type: "tenant-host"; readonly tenantId: string };
  ```
- `FindSessionInput` uses `boundary`, not exact stored scope.

**Why this change is required:** on a tenant hostname the middleware cannot know `partnerId` before reading the opaque session. Requiring an exact `SessionScope` before lookup would force the browser to resend Partner authority on every request. The repository instead looks up selector + exact hostname within an expected platform/tenant-host boundary, returns the stored scope, and the use case validates that stored tenant matches the trusted hostname-resolved tenant.

- [ ] **Step 1: Write RED session tests**

Cover:
- tenant-host lookup may return a tenant or Partner session whose stored `tenantId` matches the resolved tenant;
- tenant-host lookup rejects a Partner session from another tenant;
- platform host rejects tenant/Partner sessions;
- Partner session requires `membershipAuthorizationVersion`;
- session-created audit records `partnerId` only for Partner scope;
- opaque-token rotation/reuse semantics remain unchanged.

- [ ] **Step 2: Run RED session tests**

```bash
pnpm --filter @booking-os/api test -- create-session get-current-session validate-session prisma-session-repository session-auth.middleware
```

Expected: FAIL because Partner scope/boundary do not exist.

- [ ] **Step 3: Generalize repository lookup safely**

Replace:

```ts
findBySelector({ selector, hostname, scope })
```

with:

```ts
findBySelector({ selector, hostname, boundary })
```

The Prisma query uses exact selector + hostname and validates:
- `platform` boundary → stored `scope_type = platform`, no tenant/Partner IDs;
- `tenant-host` boundary → stored `tenant_id = boundary.tenantId` and scope is tenant or Partner.

Do not query by client Partner ID.

- [ ] **Step 4: Generalize `ValidateSessionUseCase`**

Validate stored session scope against trusted lookup boundary, not a browser-provided exact Partner scope.

Preserve:
- digest verification;
- expiry;
- idle touch;
- token overlap;
- reuse detection;
- user authorization-version check.

- [ ] **Step 5: Update middleware**

Tenant resolution still runs first. Middleware constructs:

```ts
const boundary = current.tenantId
  ? { type: "tenant-host", tenantId: current.tenantId } as const
  : { type: "platform" } as const;
```

After `GetCurrentSessionUseCase`, the returned stored scope becomes `AuthenticatedRequestContext.authScope`.

- [ ] **Step 6: Implement `SelectPartnerScopeUseCase`**

Input:

```ts
{
  authorization: ActiveTenantAuthorizationContext | ActivePartnerAuthorizationContext;
  partnerId: string; // selection hint only
  hostname: string;
  requestId: string;
}
```

It resolves an active same-user/same-tenant PartnerMembership, then creates/rotates a Partner-scoped session bound to its membership authorization version.

The use case must not trust the caller's Partner ID without repository membership proof.

- [ ] **Step 7: Run GREEN session scope tests**

```bash
pnpm --filter @booking-os/api test -- create-session get-current-session validate-session prisma-session-repository session-auth.middleware select-partner-scope
pnpm --filter @booking-os/api test:e2e -- partner-session-scope.e2e.test.ts
pnpm verify:identity-access
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/sessions apps/api/src/modules/partner/application/use-cases/select-partner-scope.use-case.ts apps/api/test/partner-session-scope.e2e.test.ts
git commit -m "feat: bind opaque sessions to Partner scope"
```

---

### Task 7: Build authoritative Partner permission loading and stale-authority reconciliation

**Files:**
- Modify: `apps/api/src/modules/authorization/application/ports/authorization-repository.port.ts`
- Modify: `apps/api/src/modules/authorization/application/use-cases/build-authorization-context.use-case.ts`
- Modify tests
- Modify: `apps/api/src/modules/memberships/infrastructure/persistence/prisma/prisma-tenant-authorization-query.adapter.ts` or split a shared authoritative-query adapter only if current module ownership requires it
- Modify adapter tests
- Modify: `packages/contracts/src/request-context.ts`
- Modify: `apps/api/src/modules/tenancy/application/tenant-execution-context.ts`
- Modify tests
- Modify: `apps/api/src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.ts`
- Modify adapter tests
- Test: `apps/api/test/partner-authorization-context.e2e.test.ts`
- Test: `apps/api/test/partner-authorization-concurrency.e2e.test.ts`

**Interfaces:**
- Produces:

```ts
interface PartnerCurrentScopeAuthority {
  readonly scope: {
    readonly type: "partner";
    readonly tenantId: string;
    readonly tenantSlug: string;
    readonly partnerId: string;
  };
  readonly membershipId: string;
  readonly membershipStatus: "invited" | "active" | "suspended" | "revoked";
  readonly membershipAuthorizationVersion: number;
  readonly userAuthorizationVersion: number;
  readonly roleKeys: readonly string[];
  readonly permissionKeys: readonly string[];
}
```

- `AuthorizedTenantExecutionContext.authorization` accepts active tenant or active Partner authorization because both run inside the tenant transaction/RLS boundary.

- [ ] **Step 1: Write RED authority tests**

Cover:
- `partner_owner` resolves exact Partner permissions;
- `partner_member` resolves only seeded member permissions;
- Partner role/permission rows from another Partner do not contribute;
- unknown role/permission identifiers fail closed;
- Partner permissions must use `partner.` prefix;
- tenant/platform permissions cannot appear in Partner effective permission set;
- inactive/revoked PartnerMembership returns no authority;
- stored Partner scope tenant/Partner IDs must exactly match repository result.

- [ ] **Step 2: Run RED authorization tests**

```bash
pnpm --filter @booking-os/api test -- build-authorization-context prisma-tenant-authorization-query tenant-execution-context prisma-tenant-transaction
pnpm --filter @booking-os/api test:e2e -- partner-authorization-context.e2e.test.ts
```

Expected: FAIL because repository/context validation is platform/tenant-only.

- [ ] **Step 3: Extend authorization repository scope/result unions**

Add Partner variants without weakening known-value validation.

`validateCatalog()` uses prefix:

```ts
const expectedPrefix =
  authority.scope.type === "platform"
    ? "platform."
    : authority.scope.type === "tenant"
      ? "tenant."
      : "partner.";
```

Role semantics:
- platform authority: only `platform_admin`;
- tenant authority: never platform/Partner roles;
- Partner authority: only `partner_owner | partner_member`.

- [ ] **Step 4: Load Partner authority transactionally**

SQL path:

```text
users
→ partner_memberships(active)
→ partners(same tenant + same partner)
→ role_assignments(scope_level = partner, same tenant + partner)
→ roles(is_system = true, scope_level = partner)
→ role_permissions
→ permissions(scope_level = partner)
```

Return unique sorted roles/permissions.

- [ ] **Step 5: Extend authorized tenant execution validation**

`requireAuthorizedTenantExecutionContext()` accepts both:
- active tenant authorization matching `tenantId`;
- active Partner authorization matching the same `tenantId` and a non-empty `partnerId`.

`PrismaTenantTransactionAdapter`:
1. locks/verifies current User authorization version;
2. sets `booking_app` + `app.tenant_id`;
3. for tenant auth, locks `tenant_memberships`;
4. for Partner auth, locks `partner_memberships` by `tenant_id + partner_id + user_id`;
5. compares exact membership ID/version;
6. reloads current authority and compares role/permission sets before application work.

- [ ] **Step 6: Prove stale Partner authority fails before use case**

In `partner-authorization-concurrency.e2e.test.ts`:
1. create active Partner member/session;
2. capture authorization;
3. revoke membership or bump version;
4. attempt a protected Partner use case with stale context;
5. assert transaction rejects with stale-authority error before repository mutation.

- [ ] **Step 7: Run GREEN authority/regression tests**

```bash
pnpm --filter @booking-os/api test -- build-authorization-context prisma-tenant-authorization-query tenant-execution-context prisma-tenant-transaction
pnpm --filter @booking-os/api test:e2e -- partner-authorization-context.e2e.test.ts partner-authorization-concurrency.e2e.test.ts authorization-context-concurrency.e2e.test.ts
pnpm verify:identity-access
pnpm verify:dynamic-rbac
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts apps/api/src/modules/authorization apps/api/src/modules/memberships apps/api/src/modules/tenancy apps/api/test/partner-authorization-context.e2e.test.ts apps/api/test/partner-authorization-concurrency.e2e.test.ts
git commit -m "feat: resolve authoritative Partner permissions"
```

---

### Task 8: Implement Partner profile, verification checklist, submit/review/approval lifecycle, and eligibility

**Files:**
- Create/update Partner domain files for checklist/review policy
- Create use cases:
  `update-partner-profile`, `submit-partner-review`,
  `list-tenant-partners`, `get-tenant-partner`,
  `request-partner-changes`, `approve-partner`,
  `reject-partner`, `suspend-partner`
- Create tests beside each use case
- Extend Partner repository/review ports as required
- Test: `apps/api/test/partner-review-lifecycle.e2e.test.ts`
- Test: `apps/api/test/partner-review-concurrency.e2e.test.ts`

**Interfaces:**
- `submitPartnerReview` requires `expectedVersion`.
- Tenant review mutations require `expectedVersion`.
- `requestChanges` and `reject` both transition `pending_review -> draft`, with immutable `PartnerReviewDecision`.
- `approve` transitions `pending_review -> active`.
- `suspend` transitions an eligible status to `suspended`.
- `PartnerEligibilityPort.canCreateInventory()` returns true only for `active`.

- [ ] **Step 1: Write RED tests for S3-PARTNER09–S3-PARTNER13 and S3-PARTNER19**

Use-case tests explicitly assert:
- individual checklist = identity + payout account + management rights;
- company checklist = business registration + payout account + management rights;
- incomplete draft cannot submit;
- approval fails when any required check is not accepted;
- request-changes/reject retain decision history and return to draft;
- approve/change/suspend with stale `expectedVersion` returns conflict;
- suspension does not delete Partner membership/history.

- [ ] **Step 2: Run RED lifecycle tests**

```bash
pnpm --filter @booking-os/api test -- partner-review approve-partner suspend-partner
pnpm --filter @booking-os/api test:e2e -- partner-review-lifecycle.e2e.test.ts partner-review-concurrency.e2e.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement profile/checklist update rules**

Bounded input DTO/domain:
- trim/canonicalize display/legal names;
- permit only expected verification check types for Partner type;
- evidence records store references, not secret-bearing URLs in audit;
- payout account persistence is onboarding/verification only; no payout execution.

- [ ] **Step 4: Implement review submission**

Atomic transaction:
```text
lock Partner
check expectedVersion
validate required checklist present
draft -> pending_review
append lifecycle history
append partner.review.submitted audit/outbox
commit
```

- [ ] **Step 5: Implement tenant review mutations**

`requestChanges`:
```text
pending_review -> draft
append PartnerReviewDecision(changes_requested)
append lifecycle history + audit/outbox
```

`reject`:
```text
pending_review -> draft
append PartnerReviewDecision(rejected)
append lifecycle history + audit/outbox
```

`approve`:
```text
pending_review -> active
append PartnerReviewDecision(approved)
append lifecycle history + audit/outbox
```

- [ ] **Step 6: Implement lifecycle authority invalidation**

For transitions changing effective product authority (`active`, `inactive`, `suspended`, `cancelled` boundaries):
1. lock active Partner memberships in deterministic UUID order;
2. transition Partner;
3. increment each affected `PartnerMembership.authorizationVersion` exactly once;
4. append history/audit/outbox;
5. commit.

- [ ] **Step 7: Prove concurrency**

Controlled PostgreSQL interleavings:
- approve vs request-changes;
- approve vs suspend;
- duplicate approve retry.

Exactly one stale-version loser; no split audit/history.

- [ ] **Step 8: Run GREEN lifecycle tests**

```bash
pnpm --filter @booking-os/api test -- partner-review approve-partner suspend-partner
pnpm --filter @booking-os/api test:e2e -- partner-review-lifecycle.e2e.test.ts partner-review-concurrency.e2e.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/partner apps/api/test/partner-review-lifecycle.e2e.test.ts apps/api/test/partner-review-concurrency.e2e.test.ts
git commit -m "feat: review and approve Partners"
```

---

### Task 9: Implement Partner member invitation, acceptance, revoke, and final-owner safety

**Files:**
- Create:
  `invite-partner-member.use-case.ts`,
  `accept-partner-membership.use-case.ts`,
  `revoke-partner-membership.use-case.ts`,
  `list-partner-memberships.use-case.ts`
- Tests beside each use case
- Extend `partner-membership-repository.port.ts`
- Extend encrypted outbox/email event integration from Task 5
- Test: `apps/api/test/partner-membership.e2e.test.ts`
- Test: `apps/api/test/partner-membership-concurrency.e2e.test.ts`

**Interfaces:**
- Partner member invite creates `PartnerMembershipInvitation` with system-role intent only.
- Acceptance requires authenticated user/session and exact tenant/Partner/user/token binding.
- `partner_owner` is the only role allowed to invite/revoke members in Sprint 3A.
- Revoking the last active Partner owner is forbidden.

- [ ] **Step 1: Write RED membership tests for S3-PARTNER16–S3-PARTNER18**

Cover:
- invite active Partner member;
- new/existing User continuation;
- duplicate acceptance converges to one active membership;
- invitation cannot cross tenant/Partner;
- inviter loses authority before acceptance → fail closed;
- revoke increments target membership authorization version;
- last-owner revoke rejects;
- two concurrent owner revokes/promotions cannot leave zero owners.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter @booking-os/api test -- partner-membership
pnpm --filter @booking-os/api test:e2e -- partner-membership.e2e.test.ts partner-membership-concurrency.e2e.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement invite**

Atomic:
```text
require active Partner scope
require partner_owner governance
lock inviter membership
create/reuse invited target membership
create one-time invitation selector/hash
append partner.membership.invited audit/outbox
commit
```

- [ ] **Step 4: Implement acceptance**

Authenticated acceptance:
```text
parse/verify token
lock invitation + target membership
verify authenticated user and exact tenant/Partner
activate exactly once
assign partner_member system role
increment membership authorization version only as required by transition contract
append partner.membership.accepted
commit
```

Token alone never creates a session.

- [ ] **Step 5: Implement revoke + final-owner invariant**

Lock order:
```text
Partner
→ active owner memberships sorted by UUID
→ target membership
```

Reject if target is the final active `partner_owner`.

A real revoke:
- sets status revoked;
- increments authorization version;
- removes/revokes Partner role assignment as designed;
- appends audit/history;
- stale sessions fail on next protected request.

- [ ] **Step 6: Run GREEN membership tests**

```bash
pnpm --filter @booking-os/api test -- partner-membership
pnpm --filter @booking-os/api test:e2e -- partner-membership.e2e.test.ts partner-membership-concurrency.e2e.test.ts
pnpm verify:identity-access
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/partner apps/api/test/partner-membership.e2e.test.ts apps/api/test/partner-membership-concurrency.e2e.test.ts
git commit -m "feat: manage Partner memberships"
```

---

### Task 10: Expose Partner HTTP APIs, session-scope selection, stable errors, and OpenAPI

**Files:**
- Create:
  `partner/infrastructure/http/partner-public.controller.ts`
  `partner/infrastructure/http/tenant-partners.controller.ts`
  `partner/infrastructure/http/partner-workspace.controller.ts`
  `partner/infrastructure/http/partner.dto.ts`
  `partner/infrastructure/http/partner-http-errors.ts`
- Create controller tests beside controllers
- Modify: `apps/api/src/modules/partner/partner.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify session HTTP controller or create a Partner-owned scope-selection controller according to existing route ownership; supported route must be exactly `POST /auth/session/partner-scope`
- Test: `apps/api/test/partner-api.e2e.test.ts`
- Regenerate:
  `packages/contracts/openapi/openapi.json`
  `packages/api-client/src/generated/schema.ts`
  `packages/api-client/src/generated/client.ts`

**Interfaces / Routes:**

Public:
```text
POST /partner/registrations
POST /partner/registrations/verify
POST /partner/registrations/resend-verification
```

Tenant:
```text
GET  /tenant/partners
GET  /tenant/partners/:partnerId
POST /tenant/partners/:partnerId/request-changes
POST /tenant/partners/:partnerId/approve
POST /tenant/partners/:partnerId/reject
POST /tenant/partners/:partnerId/suspend
```

Partner:
```text
GET    /partner/profile
PATCH  /partner/profile
POST   /partner/review-submission
GET    /partner/memberships
POST   /partner/memberships/invitations
DELETE /partner/memberships/:membershipId
```

Session:
```text
POST /auth/session/partner-scope
```

- [ ] **Step 1: Write RED controller/API tests**

Assert:
- no request DTO accepts `tenantId`;
- Partner self DTOs/routes do not accept `partnerId`;
- exact tenant hostname is required;
- authenticated mutations require CSRF/origin protection;
- every protected route has exact permission decorator;
- tenant routes deny Partner authority and vice versa where scope does not match;
- foreign Partner/member IDs use safe not-found/denied semantics;
- responses are `private, no-store` where identity/authorization data is exposed;
- public registration returns enumeration-safe accepted response;
- stable error machine codes.

- [ ] **Step 2: Run RED API tests**

```bash
pnpm --filter @booking-os/api test -- partner-public.controller tenant-partners.controller partner-workspace.controller
pnpm --filter @booking-os/api test:e2e -- partner-api.e2e.test.ts
```

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement controllers using current conventions**

Use:
- `@SupportedApi()`;
- `@ApiTags`;
- `@ApiOperation({ operationId: ... })`;
- named DTOs;
- `@SessionRequired()`;
- `@RequiresPermission(PERMISSION_KEYS...)`;
- `SessionCsrfGuard` + `PermissionGuard`;
- `CurrentAuthorizationContext`.

Controllers parse transport values then invoke use cases; no Prisma access.

- [ ] **Step 4: Implement stable Partner HTTP error mapping**

Map:
```text
400 PARTNER_REGISTRATION_VERIFICATION_INVALID / malformed input
401 authentication required
403 PARTNER_ACCESS_DENIED
404 PARTNER_NOT_FOUND / PARTNER_MEMBERSHIP_NOT_FOUND
409 PARTNER_STATE_CONFLICT / version conflict / last-owner conflict
422 PARTNER_REVIEW_REQUIREMENTS_INCOMPLETE
429 registration/resend abuse
```

Never expose Prisma/SQL/constraint names.

- [ ] **Step 5: Wire middleware routes explicitly**

`AppModule.configure()`:
- public Partner registration: `HttpSecurityMiddleware` + `TenantResolutionMiddleware`, no session requirement;
- tenant/Partner/session-scope protected routes: `TenantResolutionMiddleware` then `SessionAuthMiddleware`;
- preserve existing platform route ordering.

- [ ] **Step 6: Generate and verify API contract**

```bash
pnpm api:generate
pnpm api:check-generated
pnpm api:check-breaking
```

Expected: PASS with additive Partner routes/contracts.

- [ ] **Step 7: Run GREEN HTTP/architecture tests**

```bash
pnpm --filter @booking-os/api test -- partner-public.controller tenant-partners.controller partner-workspace.controller
pnpm --filter @booking-os/api test:e2e -- partner-api.e2e.test.ts
pnpm verify:architecture
pnpm api:check-generated
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/partner apps/api/src/modules/sessions apps/api/src/app.module.ts apps/api/test/partner-api.e2e.test.ts packages/contracts/openapi packages/api-client/src/generated
git commit -m "feat: expose Partner onboarding API"
```

---

### Task 11: Build minimum web-console Partner vertical slice

**Files:**
- Create pages:
  `apps/web-console/app/partner/register/page.tsx`
  `apps/web-console/app/partner/verify/page.tsx`
  `apps/web-console/app/partner/onboarding/page.tsx`
  `apps/web-console/app/partner/review-status/page.tsx`
  `apps/web-console/app/partner/members/page.tsx`
  `apps/web-console/app/partners/page.tsx`
  `apps/web-console/app/partners/[partnerId]/page.tsx`
- Create focused components under `apps/web-console/components/partner/`
- Create BFF route handlers under:
  `apps/web-console/app/api/partner/**`
  `apps/web-console/app/api/tenant/partners/**`
  `apps/web-console/app/api/auth/session/partner-scope/route.ts`
- Modify: `apps/web-console/middleware.ts` and test only for explicit public/protected Partner route classification
- Create: `apps/web-console/e2e/partner-onboarding.spec.ts`

**Interfaces:**
- Browser only calls same-origin BFF.
- Partner secret fragments are consumed/stripped in client components before submission.
- No Partner secret is stored in browser persistence.

- [ ] **Step 1: Write RED route/middleware tests**

Assert:
- `/partner/register` and `/partner/verify` are public tenant-host routes;
- onboarding/review/members require authenticated Partner-capable flow;
- `/partners` tenant-operator routes remain tenant-authenticated;
- no social-login controls appear.

- [ ] **Step 2: Write RED browser E2E skeleton**

Scenario:

```text
new user registers Partner
→ receives one email
→ opens fragment link
→ fragment is stripped
→ activates/signs in
→ completes individual/company checklist
→ submits
→ tenant operator reviews/approves
→ owner selects Partner workspace
→ owner invites member
→ member accepts
```

Assert `active` Partner workspace state; do not create Listing UI.

- [ ] **Step 3: Implement BFF handlers**

Follow existing auth/session BFF pattern: forward cookies/CSRF, normalize API errors, never expose raw backend tokens beyond in-memory fragment continuation.

- [ ] **Step 4: Implement registration/verification UI**

Registration fields:
- email;
- Partner type;
- display name;
- legal/business name when applicable;
- bounded contact info.

Verification page:
```ts
const params = new URLSearchParams(window.location.hash.slice(1));
history.replaceState(null, "", window.location.pathname);
```

Keep secrets only in component memory.

- [ ] **Step 5: Implement onboarding/review UI**

Show:
- Partner profile;
- type-specific checklist;
- payout-account verification state;
- management-rights evidence state;
- submit-for-review;
- immutable review feedback/status.

- [ ] **Step 6: Implement tenant review UI**

`/partners` list and detail:
- read Partner state;
- request changes;
- approve;
- reject;
- suspend;
- include current version in mutations;
- refresh state after conflict instead of blind retry.

- [ ] **Step 7: Implement Partner members UI**

Owner:
- list memberships;
- invite by email;
- revoke non-final owner/member;
- surface safe final-owner error.

- [ ] **Step 8: Run GREEN web tests**

```bash
pnpm --filter @booking-os/web-console test
pnpm --filter @booking-os/web-console typecheck
pnpm build
pnpm test:e2e -- --grep "Partner onboarding"
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web-console
git commit -m "feat: add Partner onboarding console"
```

---

### Task 12: Add S3-PARTNER01–20 executable acceptance verifier and protected CI gate

**Files:**
- Create: `scripts/verify-partner-onboarding.mjs`
- Create: `scripts/verify-partner-onboarding.test.mjs`
- Create: `apps/api/test/partner-onboarding-acceptance.e2e.test.ts`
- Modify: root `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify any Sprint 0/Foundation gate registry that explicitly enumerates protected verification commands
- Preserve: `scripts/verify-identity-access.mjs`, `scripts/verify-dynamic-rbac.mjs` behavior

**Interfaces:**
- Adds:
  ```json
  "verify:partner-onboarding": "node scripts/verify-partner-onboarding.mjs"
  ```
- `verify:foundation` order:
  ```text
  migrations
  → identity-access
  → dynamic-rbac
  → partner-onboarding
  → build/browser/production-config
  ```
- CI adds `partner-onboarding` job with `needs: dynamic-rbac`; `build.needs` becomes `partner-onboarding`.

- [ ] **Step 1: Write RED verifier tests first**

The verifier test fails unless:
- all 20 acceptance IDs exist exactly once in dedicated mapping;
- each maps to executable test/gate evidence;
- root script exists;
- `verify:foundation` invokes it after dynamic RBAC;
- CI protected job exists before build.

- [ ] **Step 2: Run RED verifier**

```bash
node --test scripts/verify-partner-onboarding.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Build dedicated acceptance file**

`partner-onboarding-acceptance.e2e.test.ts` contains named executable cases or explicit mapping markers for:

```text
S3-PARTNER01 new-user tenant-bound registration
S3-PARTNER02 existing identity reuse
S3-PARTNER03 duplicate same-tenant/email safety
S3-PARTNER04 same email across tenants
S3-PARTNER05 secret-safe one-time verification
S3-PARTNER06 exact binding
S3-PARTNER07 one-message normal auth continuation
S3-PARTNER08 verification != approval
S3-PARTNER09 type-specific checklist
S3-PARTNER10 incomplete submit blocked
S3-PARTNER11 atomic approval
S3-PARTNER12 change/reject history recovery
S3-PARTNER13 lifecycle races
S3-PARTNER14 Partner session membership binding
S3-PARTNER15 cross-Partner isolation
S3-PARTNER16 invitation convergence
S3-PARTNER17 final Partner owner
S3-PARTNER18 stale membership authority
S3-PARTNER19 suspension
S3-PARTNER20 protected regression chain
```

- [ ] **Step 4: Implement verifier**

Use spawned commands with explicit environment forwarding. Verify concrete files/markers and run the dedicated acceptance test; do not pass via string search alone.

- [ ] **Step 5: Wire root Foundation command**

Insert:

```text
pnpm verify:partner-onboarding
```

immediately after `pnpm verify:dynamic-rbac` and before `pnpm build`.

- [ ] **Step 6: Add protected CI job**

Copy service/runtime conventions from dynamic-RBAC job, use a distinct database such as:

```text
booking_os_partner_onboarding
```

with:
```text
SESSION_SECRET=partner-onboarding-only-secret-at-least-32-characters
```

Then:

```yaml
partner-onboarding:
  name: Sprint 3A Partner onboarding acceptance
  needs: dynamic-rbac
  ...
  - name: Run Sprint 3A Partner onboarding acceptance
    run: pnpm verify:partner-onboarding

build:
  needs: partner-onboarding
```

- [ ] **Step 7: Run GREEN verifier and protected local-equivalent commands**

```bash
node --test scripts/verify-partner-onboarding.test.mjs
pnpm verify:partner-onboarding
pnpm verify:identity-access
pnpm verify:dynamic-rbac
pnpm verify:architecture
pnpm api:check-generated
pnpm build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/verify-partner-onboarding.mjs scripts/verify-partner-onboarding.test.mjs apps/api/test/partner-onboarding-acceptance.e2e.test.ts package.json .github/workflows/ci.yml
git commit -m "ci: protect Partner onboarding acceptance"
```

---

### Task 13: Close Sprint 3A knowledge, recovery guidance, roadmap/Pilot checkpoint, and exact-head verification

**Files:**
- Create: `docs/features/FEATURE-0004-partner-onboarding-authorization.md`
- Create: `docs/patterns/PATTERN-0005-partner-authority-scope.md`
- Create: `docs/runbooks/partner-onboarding-recovery.md`
- Modify: `docs/plan/90-DAY-EXECUTION.md`
- Modify: `genesis/reviews/PILOT-GATES.md`
- Create: `docs/superpowers/checkpoints/2026-08-20-sprint-3a-partner-onboarding-closeout.md`
- Add Genesis validation tests/markers following existing Sprint 2 closeout pattern
- Keep implementation plan detailed recipe checkboxes historical; use plan-level completion metadata only when technical closeout is actually verified

**Interfaces:**
- Knowledge explains:
  Partner scope, PartnerMembership authority epoch, verification-vs-approval, final owner, FORCE-RLS layering, suspension recovery, and eligibility contract.

- [ ] **Step 1: Write RED knowledge validation**

Require all six closeout artifact/marker categories before creating them, matching the Sprint 2 RED→validator-GREEN→knowledge-GREEN pattern.

- [ ] **Step 2: Run RED Genesis/Sprint 0 validation**

```bash
pnpm genesis:validate
pnpm test:scripts
```

Expected: FAIL only on the newly required Sprint 3A knowledge artifacts/markers.

- [ ] **Step 3: Write feature/pattern/runbook**

Runbook covers:
- duplicate/stuck Partner registration;
- expired verification;
- activation succeeded but continuation login failed;
- incorrect review decision;
- Partner suspension;
- last-owner recovery;
- stale Partner session after membership authority change;
- Partner email delivery outage;
- no destructive deletion of Partner history.

- [ ] **Step 4: Update roadmap and Pilot gates truthfully**

Roadmap marks only Sprint 3A Partner onboarding/authorization foundation complete; Catalog/Availability/Pricing remain pending.

Pilot checkpoint closes only Partner onboarding/security slice, not broader Booking/Finance/Operations gates.

- [ ] **Step 5: Run knowledge GREEN**

```bash
pnpm genesis:validate
pnpm test:scripts
```

Expected: PASS.

- [ ] **Step 6: Run full protected verification on exact closeout head**

```bash
pnpm verify:foundation
pnpm api:check-generated
pnpm api:check-breaking
pnpm audit --audit-level high
```

Also require committed-secret scan in GitHub protected CI; do not claim local gitleaks unless actually run.

- [ ] **Step 7: Record exact evidence**

Checkpoint records:
- final implementation SHA;
- `S3-PARTNER01–20` mapping;
- protected workflow run numbers on the exact SHA;
- any expected waivers with expiry/owner;
- review-handoff state.

Do not fabricate reviewer approval.

- [ ] **Step 8: Commit closeout knowledge**

```bash
git add docs/features/FEATURE-0004-partner-onboarding-authorization.md docs/patterns/PATTERN-0005-partner-authority-scope.md docs/runbooks/partner-onboarding-recovery.md docs/plan/90-DAY-EXECUTION.md genesis/reviews/PILOT-GATES.md docs/superpowers/checkpoints/2026-08-20-sprint-3a-partner-onboarding-closeout.md tools
git commit -m "docs: close Sprint 3A Partner onboarding"
```

---

## Sprint 3A Completion Gate

Technical completion requires every item below to be backed by executable or protected evidence:

- [ ] `partner` is a first-class authorization/session scope with exact tenant + Partner binding.
- [ ] `partner_owner` and `partner_member` are immutable code-seeded system roles.
- [ ] Sprint 3A tenant/Partner Permission Catalog V2 entries are code-seeded and append-only.
- [ ] Partner persistence is tenant-owned, same-tenant constrained, FORCE-RLS protected, and migration-verified.
- [ ] Partner registration supports new and existing identities without creating parallel credentials.
- [ ] New-user Partner onboarding emits one encrypted secret-safe email continuation.
- [ ] Partner registration verification is one-time, exact-bound, and never authenticates by itself.
- [ ] Email verification does not activate marketplace eligibility.
- [ ] Individual/company verification checklists enforce the approved Pilot requirements.
- [ ] Submit/review/request-changes/reject/approve/suspend lifecycle is optimistic-versioned and auditable.
- [ ] Authority-changing Partner lifecycle transitions bump affected Partner membership authorization versions exactly once.
- [ ] Partner sessions can be restored from opaque cookie + trusted hostname without browser-supplied Partner authority.
- [ ] Partner self routes derive `partnerId` from authoritative scope.
- [ ] Cross-Partner access within the same tenant fails closed.
- [ ] Partner member invitation/acceptance converges to one active membership.
- [ ] Final Partner owner safety holds under normal and concurrent mutation.
- [ ] Membership revoke/lifecycle authority changes block stale Partner sessions before protected work.
- [ ] Required business mutation + history + audit + outbox operations are atomic.
- [ ] HTTP routes use stable errors, CSRF/origin policy, no-store handling, and additive OpenAPI contracts.
- [ ] Minimum web-console registration→approval→member-invite flow passes browser E2E.
- [ ] `S3-PARTNER01`–`S3-PARTNER20` resolve to executable passing evidence through `pnpm verify:partner-onboarding`.
- [ ] `verify:identity-access` and `verify:dynamic-rbac` remain protected-green.
- [ ] Architecture, migrations, OpenAPI, build, browser smoke, production config, dependency audit, and committed-secret scan are fresh-green on closeout head.
- [ ] Partner eligibility port is exported for the next Catalog slice without implementing Catalog.
- [ ] Listing/Availability/Pricing/Booking/Payment/Finance/Partner custom Role Builder remain out of scope.
- [ ] Review handoff is recorded truthfully; ready/merge/reviewer actions require explicit user authorization.

## Execution Boundary

This plan is an implementation recipe, not authorization to mutate GitHub.

Repository operations remain separately authorized:
- creating/updating the spec or plan in the branch;
- commit;
- push;
- PR creation/body changes;
- mark-ready;
- reviewer requests;
- merge.

When implementation begins, use an isolated worktree if available and execute tasks in order. Do not start Task 2 before Task 1 GREEN, and do not start Task 7 until Task 6 Partner-session storage is GREEN because authoritative Partner context depends on stored Partner scope.
