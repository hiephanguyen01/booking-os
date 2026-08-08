# Sprint 1B.3 Membership and Tenant Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fixed system roles, tenant memberships, secure invitations, platform tenant provisioning, restricted invitation-pending sessions, explicit acceptance, and final-owner safety.

**Architecture:** `MembershipsModule` owns invitation, membership, role-assignment, grant-policy, and owner-invariant use cases. Platform operations authorize globally and then enter one explicit target-tenant RLS transaction. Identity and sessions are consumed through ports. Acceptance atomically activates membership, assigns role, increments authorization version, activates the first-owner tenant, elevates the session, and rotates the token.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11.1, Prisma 6.19, PostgreSQL 17 FORCE RLS, Node test runner, Supertest, Next.js App Router, Playwright, pnpm 10.

## Global Constraints

- Begin after Plans 1–2 review on `feat/sprint-1b-03-membership-provisioning` from the accepted Plan 2 head.
- Follow red-green-refactor and keep every commit buildable.
- Roles are immutable system roles only: `platform_admin`, `tenant_owner`, `tenant_admin`.
- No public signup, partner/affiliate scope, regular member role, custom role, subscription, or entitlement.
- Controllers and product modules request permission keys; they do not inspect role names.
- Platform admin creates a tenant/initial owner invitation but cannot directly activate membership.
- Owners can grant admin and promote active admin to owner. Admins can grant admin only and cannot alter owners/platform roles.
- Invitations are single-use, 24-hour, exact-host/user/tenant/role/purpose bound, stored only as selector plus keyed digest.
- Existing Global User and credential are reused. Invitation token never authenticates or creates a session.
- Password authentication plus valid pending invitation may create `invitation_pending`; it has an explicit route allowlist and no normal permissions.
- Acceptance is atomic across membership, role, version, first-owner tenant activation, session elevation, rotation, audit.
- Tenant-owned membership/invitation/role/session/audit rows have `tenant_id`, FORCE RLS, policy-manifest coverage.
- Platform mutations target one tenant transaction; no API cross-tenant RLS bypass.
- Active tenant always has at least one active owner, enforced by application locking and commit-time database invariant.
- Provisioning tenant exposes only health, activation, login/reset, invite inspect/accept, `/auth/me`, CSRF, logout.

---

### Task 1: Membership Schema, Tenant Lifecycle, RLS, and Final-Owner Invariant

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`
- Create: `apps/api/prisma/migrations/20260805_membership_provisioning/migration.sql`
- Modify tenant policy manifest/verifier tests
- Create: `membership-schema.integration.test.ts`, `membership-rls.integration.test.ts`, `final-owner-invariant.integration.test.ts`

**Produces:** `Tenant.status`, `TenantDomain`, `TenantMembership`, `MembershipInvitation`, tenant `RoleAssignment`; deterministic tenant role/permission seeds.

- [ ] Write tests for one membership/user/tenant, one active invitation/email/role, exact scope/status constraints, cross-tenant denial, missing context, deterministic seeds, final-owner commit failure, safe owner replacement, and concurrent demotion.
- [ ] Run `pnpm --filter @booking-os/api test:e2e -- membership-schema.integration.test.ts membership-rls.integration.test.ts final-owner-invariant.integration.test.ts`; expected FAIL.
- [ ] Implement additive migration, RLS, indexes, and deferred constraint trigger/equivalent. Seed approved tenant permissions.
- [ ] Run migrate/seed, focused tests, policy verifier, migration verifier; expected PASS.
- [ ] Commit: `feat: add tenant membership schema`.

### Task 2: Role, Permission, and Grant Policy

**Files:**
- Rewrite `packages/auth/src/roles.ts`, `permissions.ts`, `authorization.ts`
- Create `packages/auth/src/grant-policy.ts`; update exports/tests
- Create `packages/contracts/src/auth/authorization-context.ts`, `auth/index.ts`, tests; update root export.

**Produces:**
```ts
const SYSTEM_ROLES = { platformAdmin: "platform_admin", tenantOwner: "tenant_owner", tenantAdmin: "tenant_admin" } as const;
function canGrantRole(input: { actorRoles: readonly SystemRole[]; targetCurrentRoles: readonly SystemRole[]; requestedRole: SystemRole; action: "invite"|"promote"|"demote"|"suspend"|"revoke" }): GrantDecision;
```

**Permission catalog:** `tenant.membership.read`, `.admin.invite`, `.admin.suspend`, `.admin.revoke`, `.owner.promote`, `.owner.demote`, `tenant.security.session.read`, `.revoke`.

- [ ] Write catalog tests removing partner/affiliate exports and complete actor/target/action grant matrix tests.
- [ ] Run `pnpm --filter @booking-os/auth test`; expected FAIL.
- [ ] Implement immutable catalogs, mappings, and pure grant policy; no controller role branching.
- [ ] Run auth/contracts tests/typecheck; expected PASS.
- [ ] Commit: `feat: define tenant grant policy`.

### Task 3: Membership Application Boundary and RLS Adapters

**Files:**
- Create domain: `tenant-membership.ts`, `membership-invitation.ts`, `tenant-role-assignment.ts`, `membership-errors.ts`
- Create ports: `membership-repository.port.ts`, `invitation-repository.port.ts`, `tenant-provisioning.port.ts`, `identity-provisioning.port.ts`, `session-elevation.port.ts`, `authorization-query.port.ts`
- Create exact Prisma adapters/tests for membership, invitation, role assignment, tenant provisioning
- Create `memberships.tokens.ts`, `memberships.module.ts`; modify `AppModule`, tenancy transaction capabilities, architecture manifest.

**Produces:**
```ts
interface MembershipDataSession {
  memberships: MembershipRepositoryPort;
  invitations: InvitationRepositoryPort;
  roles: TenantRoleAssignmentRepositoryPort;
  tenants: TenantProvisioningRepositoryPort;
  audit: TenantSecurityAuditPort;
}
```

- [ ] Write tests proving tenant ID comes only from execution context, platform orchestration enters one target tenant transaction, RLS, row locks, role assignment, version increments, and no cross-module infrastructure import.
- [ ] Run `pnpm --filter @booking-os/api test -- "apps/api/src/modules/memberships/**/*.test.ts"`; expected FAIL.
- [ ] Implement domain/ports/adapters and dedicated errors: `MEMBERSHIP_REQUIRED`, `MEMBERSHIP_INACTIVE`, `INVITATION_INVALID_OR_EXPIRED`, `ROLE_GRANT_NOT_ALLOWED`, `LAST_TENANT_OWNER`, `TENANT_NOT_AVAILABLE`.
- [ ] Rerun focused tests/typecheck/architecture; expected PASS.
- [ ] Commit: `feat: add membership application boundary`.

### Task 4: Platform Tenant Provisioning and Initial Owner

**Files:**
- Create use cases/tests: `provision-tenant`, `get-tenant-provisioning`, `resend-owner-invitation`
- Create `platform-tenants.controller.ts`, DTO/test, `platform-tenant-provisioning.e2e.test.ts`
- Modify tenant-slug policy/tests and environment schema.

**Routes:** `POST /platform/tenants`, `GET /platform/tenants/:tenantId`, `POST /platform/tenants/:tenantId/owner-invitation/resend`.

- [ ] Write tests for exact platform host/permission, reserved label, duplicate slug/domain, neutral owner existence, new/existing user, transactional tenant/domain/membership/invitation/outbox, idempotency replay, audit, and scope mismatch.
- [ ] Run `pnpm --filter @booking-os/api test -- provision-tenant.use-case.test.ts get-tenant-provisioning.use-case.test.ts resend-owner-invitation.use-case.test.ts`; expected FAIL.
- [ ] Implement global authorization followed by one explicit target-tenant transaction; keep tenant `provisioning`.
- [ ] Run unit/E2E, OpenAPI generation/check, architecture; expected PASS.
- [ ] Commit: `feat: provision tenants and initial owners`.

### Task 5: Tenant Admin Invitations

**Files:**
- Create use cases/tests: `invite-tenant-admin`, `resend-invitation`, `get-current-invitation`
- Create invitation controller/test and `membership-invitation.e2e.test.ts`
- Modify worker identity-email event/dispatcher and exact tests.

**Routes:** `GET /membership/invitations/current`, `POST /membership/invitations`, `POST /membership/invitations/:invitationId/resend`.

- [x] Write tests for owner/admin grant matrix, neutral response, existing-user reuse, new-user activation+invite, TTL/binding, resend invalidation, encrypted outbox, duplicate concurrency, and no raw token leakage.
- [x] Run `pnpm --filter @booking-os/api test -- invite-tenant-admin.use-case.test.ts resend-invitation.use-case.test.ts get-current-invitation.use-case.test.ts`; expected FAIL.
- [x] Implement flows. Email worker builds fragment URL only after envelope decryption.
- [x] Run API E2E, worker tests, architecture; expected PASS.
- [x] Commit: `feat: invite tenant administrators`.

### Task 6: Invitation-Pending Session and Atomic Acceptance

**Files:**
- Create `accept-invitation.use-case.ts`/test and `invitation-pending-route-policy.ts`/test
- Modify session login use case/test and session-required guard/test
- Modify invitation controller
- Create `invitation-acceptance.e2e.test.ts`, `invitation-acceptance-concurrency.e2e.test.ts`

**Restricted allowlist:** `GET /auth/csrf`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/password/reset`, `GET /membership/invitations/current`, `POST /membership/invitations/accept`. No other route is admitted.

- [x] Write login tests for valid pending invitation, wrong host/expired/generic failure, and denial of memberships/invite/probe routes. Write acceptance tests for token lock/binding, one concurrency winner, membership/role/version/tenant/session/rotation atomicity.
- [x] Run `pnpm --filter @booking-os/api test -- accept-invitation.use-case.test.ts invitation-pending-route-policy.test.ts login.use-case.test.ts`; expected FAIL.
- [x] Implement pending subject resolution through membership port and transactional acceptance/session elevation without Prisma leakage.
- [x] Run unit/concurrency/E2E/architecture; expected PASS.
- [x] Commit: `feat: accept tenant invitations atomically`.

### Task 7: Membership Management and Session Consequences

**Files:**
- Create use cases/tests: `list-memberships`, `suspend-membership`, `revoke-membership`, `promote-owner`, `demote-owner`
- Create memberships controller/test
- Create `membership-management.e2e.test.ts`, `membership-session-revocation.e2e.test.ts`
- Extend session-repository port for target tenant revocation.

**Routes:** `GET /memberships`; POST suspend/revoke/promote-owner/demote-owner.

- [x] Write tests for owner/admin boundaries, self-target, cross-tenant IDs, last-owner rejection, concurrent demotion, version increments, audit, and affected tenant-session revocation.
- [x] Run focused membership use-case tests; expected FAIL.
- [x] Implement tenant/owner-set locking and transitions; database invariant remains final layer.
- [x] Run unit/E2E/concurrency/architecture; expected PASS.
- [x] Commit: `feat: manage tenant memberships safely`.

### Task 8: Minimal Platform and Membership UI

**Files:**
- Create platform create/status pages/forms and BFF routes/tests
- Create `/invite/accept` page/component and membership BFF routes/tests
- Create settings/members page/invite form/tests
- Create `e2e/tenant-provisioning.spec.ts`, `membership-management.spec.ts`.

- [x] Write tests for fragment stripping, explicit acceptance, provisioning status, neutral existence, safe role choices, last-owner errors, CSRF/no-store.
- [x] Run `pnpm --filter @booking-os/web-console test`; expected FAIL.
- [x] Implement only the approved minimal UI; no custom roles, subscription selector, or generalized onboarding.
- [x] Run web tests, full browser vertical slice, `pnpm verify:foundation`; expected PASS.
- [x] Commit: `feat: add tenant provisioning UI`.

## Plan 3 Completion Gate

- [x] Eight scoped task histories exist across the accepted Plan 3 work and continuation PR.
- [x] Platform admin creates provisioning tenant and initial owner invite.
- [x] New owner activates/logs in/accepts and atomically activates tenant.
- [x] Existing global user joins a second tenant with same credential.
- [x] Token never authenticates; pending session reaches only allowlist.
- [x] Grant matrix and final-owner invariant pass unit/integration/concurrency/E2E.
- [x] All tenant-owned identity-access rows have FORCE RLS.
- [x] Minimal UI exercises the vertical slice and clean-head foundation/CI gates pass.
- [x] Draft PR remains open for the Sprint 1B.3 continuation; stop before Plan 4.
