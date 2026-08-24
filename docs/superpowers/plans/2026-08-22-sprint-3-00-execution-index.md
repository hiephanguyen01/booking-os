# Sprint 3 Partner Foundation & Onboarding — Execution Index and Self-Review Amendments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Read this file before Plans 3.1-3.4. Where a child plan uses a migration-path template or leaves an implementation detail less specific, this execution index is the canonical instruction.

**Goal:** Make the four approved Sprint 3 implementation plans execution-ready by resolving cross-plan contracts, exact migration paths, registration/membership concurrency, evidence-safety semantics, and the complete DB/concurrency acceptance mapping without changing the approved product architecture.

**Spec:** `docs/superpowers/specs/2026-08-22-sprint-3-partner-foundation-onboarding-design.md`

## Execution prerequisite

Do not implement Sprint 3 production code while PR #32 remains unmerged. After #32 is reviewed and merged:

1. verify the updated `main` head and its protected checks;
2. invoke `superpowers:using-git-worktrees`;
3. create a new isolated Sprint 3 branch/worktree from that updated `main`;
4. carry the approved Sprint 3 spec plus this index and Plans 3.1-3.4 into that branch;
5. execute Plans 3.1 -> 3.2 -> 3.3 -> 3.4 in order, never skipping a plan completion gate.

Do not mark any Sprint 3 PR Ready, request/fabricate reviewers, or merge automatically.

## Canonical plan sequence

1. `docs/superpowers/plans/2026-08-22-sprint-3-01-partner-authority-persistence-foundation.md`
2. `docs/superpowers/plans/2026-08-22-sprint-3-02-partner-registration-session.md`
3. `docs/superpowers/plans/2026-08-22-sprint-3-03-partner-self-service-onboarding.md`
4. `docs/superpowers/plans/2026-08-22-sprint-3-04-partner-review-lifecycle-closeout.md`

## Exact migration paths

The `<timestamp>` migration path notation in the child plans is resolved here. Use these exact directories unless execution discovers an already-existing directory with the same name; if that happens, stop and choose the next deterministic suffix before writing migration content.

```text
apps/api/prisma/migrations/20260822_01_partner_authority_foundation/migration.sql
apps/api/prisma/migrations/20260822_02_partner_registration/migration.sql
apps/api/prisma/migrations/20260822_03_partner_onboarding_material/migration.sql
apps/api/prisma/migrations/20260822_04_partner_review_lifecycle/migration.sql
```

Do not generate a differently named migration merely because Prisma CLI proposes a timestamp; the committed path is part of the execution evidence.

## Cross-plan type contract

Use one canonical vocabulary across all four plans:

```ts
export type PartnerType = "individual" | "company";

export type PartnerApplicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "approved"
  | "rejected";

export type PartnerOperationalStatus =
  | "inactive"
  | "active"
  | "suspended"
  | "cancelled";

export interface PartnerAuthorizationSnapshot {
  readonly partnerId: string;
  readonly partnerAuthorizationVersion: number;
  readonly partnerMembershipId: string;
  readonly partnerMembershipAuthorizationVersion: number;
  readonly roleKeys: readonly ("partner_owner" | "partner_admin")[];
  readonly permissions: readonly string[];
}
```

HTTP/use-case code may wrap this in the repository's existing `AuthorizationContext`, but must not introduce a second independent authority model called `PartnerAuthorizationContext`. Partner IDs in DTOs are resource identifiers only on Tenant governance routes; `/partner/me/*` gets the Partner ID from the authenticated server-side context.

## Plan 3.1 mandatory clarifications

### Partner system-role assignment schema

`PartnerSystemRoleAssignment` is a historical assignment, not a mutable identity tuple. Use at least:

```text
id uuid PK
tenant_id uuid NOT NULL
partner_id uuid NOT NULL
partner_membership_id uuid NOT NULL
role_id uuid NOT NULL
created_at timestamptz NOT NULL
revoked_at timestamptz NULL
```

Required database invariants:

- composite FK `(partner_membership_id, partner_id, tenant_id)` -> same PartnerMembership identity;
- role must be a system Role with `scope_level = partner`;
- active partial unique index on `(tenant_id, partner_id, partner_membership_id, role_id)` where `revoked_at IS NULL`;
- `tenant_id`, `partner_id`, `partner_membership_id`, and `role_id` are immutable after insert;
- `revoked_at: NULL -> timestamp` allowed; `timestamp -> NULL` forbidden;
- normal `booking_app` privileges are `SELECT, INSERT, UPDATE`, with no DELETE.

### AuthSession same-tenant Partner binding

Adding `partner_id` to `auth_sessions` is not enough. Partner-scoped session persistence must structurally prevent pairing a Tenant A session with a Tenant B Partner. Add the needed composite uniqueness/FK so `(partner_id, tenant_id)` references `partners(id, tenant_id)` when Partner scope is present. Platform/Tenant session rows keep `partner_id` and Partner authorization-version columns null; Partner scope rows require them through migration-level CHECK constraints or equivalent verified persistence invariants.

## Plan 3.2 mandatory clarifications

### Public Partner registration must ensure a TenantMembership

The approved authority chain is:

```text
User -> TenantMembership -> PartnerMembership -> Partner
```

Therefore `CompletePartnerRegistration` must not create PartnerMembership against a missing TenantMembership.

Extend the exported registration bridge so completion returns/ensures both identity and tenant participation:

```ts
export interface VerifiedPartnerIdentity {
  readonly userId: string;
  readonly userAuthorizationVersion: number;
  readonly tenantMembershipId: string;
  readonly tenantMembershipAuthorizationVersion: number;
  readonly wasUserCreatedOrActivated: boolean;
  readonly wasTenantMembershipCreated: boolean;
}
```

Required behavior inside the atomic establishment transaction:

- existing active same-tenant TenantMembership -> reuse it;
- no TenantMembership -> create an `active` TenantMembership for the verified User and tenant;
- that auto-created TenantMembership receives **no `tenant_owner`, `tenant_admin`, or tenant custom-role assignment**;
- suspended/revoked same-tenant TenantMembership -> fail closed; do not silently reactivate it;
- PartnerMembership then references the ensured `(tenant_membership_id, tenant_id)` composite identity.

This TenantMembership exists so host/tenant/session invariants remain authoritative; Partner capabilities come from Partner system-role assignments, not Tenant admin roles.

### One canonical registration row per tenant/email

A uniqueness constraint keyed only by challenge ID does not satisfy `P3-CON12`, because two different simultaneous challenges could each establish a Partner. For Sprint 3 public registration, use one persistent registration row per `(tenant_id, normalized_email)`:

```prisma
@@unique([tenantId, normalizedEmail])
```

The registration repository contract is therefore canonicalized to:

```ts
export interface PartnerRegistrationChallengeRepositoryPort {
  upsertForEmail(input: UpsertPartnerRegistrationChallengeInput): Promise<PartnerRegistrationChallengeRecord>;
  lockBySelector(selector: string): Promise<PartnerRegistrationChallengeRecord | null>;
  markCompleted(input: {
    challengeId: string;
    partnerId: string;
    consumedAt: Date;
  }): Promise<void>;
}
```

`StartPartnerRegistration` rotates/replaces `selector`, `token_hash`, expiry, display email, Partner type, and hostname on the same uncompleted row. It never clears `completed_partner_id`. A start after completion remains enumeration-safe and must not create a second establishment row.

This constraint applies only to the Sprint 3 **public initial registration flow**. It does not prevent the same User/TenantMembership from participating in additional Partners through future explicit membership/delegation workflows.

Required PostgreSQL races:

- two simultaneous starts for the same tenant/email converge to one registration row;
- two simultaneous completions of the same token establish one Partner;
- two distinct concurrently issued/rotated tokens for the same tenant/email cannot establish two Partners;
- repeated completion returns the canonical completed Partner without duplicate audit/outbox/role side effects.

## Plan 3.3 mandatory clarification: evidence safety is executable in Pilot

Do not leave a production-only “scanner hook” with no path to `clean`. Sprint 3 does not require a new antivirus service. Define the current Pilot evidence-safety policy as synchronous server-side validation at finalize time:

1. object exists at the server-generated key;
2. actual object size is within the configured bound;
3. actual content type is in the allowlist and matches the signed upload intent;
4. checksum is present and matches the finalized metadata contract;
5. object path is inside the configured private Partner evidence bucket/prefix;
6. original/display filename is sanitized and is never used as the storage key;
7. risky document responses are attachment-only and never inline-rendered as executable HTML.

On successful current Pilot safety validation, persist `safety_status = clean`. On mismatch, persist/transition to `quarantined` (or reject finalize atomically if no evidence row has yet been created). A future malware scanner may extend the `PartnerEvidenceSafetyPort`/policy and introduce `pending_scan`; Sprint 3 must not claim malware scanning exists when it does not.

Update Plan 3.3 execution accordingly:

- `pending_scan` is allowed in the enum for future asynchronous scanning but is not the normal finalized state in the current Pilot adapter;
- `FinalizePartnerEvidence` performs the seven checks above and records `clean` only after they all pass;
- Tenant review in Plan 3.4 accepts only `clean` evidence;
- tests must prove content-type/size/checksum/key mismatches never become reviewer-consumable.

## Plan 3.4 mandatory clarification: trusted inventory eligibility input

`PartnerInventoryEligibilityContract.assertCanCreateInventory({ tenantId, partnerId })` is an application-to-application contract. The `tenantId` argument must come from a trusted Catalog execution context, never an HTTP body/header/query. The contract must re-check `(tenant_id, partner_id)` and `operational_status = active`; Catalog remains out of Sprint 3.

## Canonical database acceptance mapping

`pnpm verify:partner-onboarding` must map these exact IDs to executable PostgreSQL evidence:

```text
P3-DB01 Tenant A cannot SELECT Partner of Tenant B.
P3-DB02 Tenant A cannot INSERT a Partner child row pointing to Tenant B Partner.
P3-DB03 PartnerMembership cannot reference a foreign-tenant TenantMembership.
P3-DB04 Partner/child tenant_id or partner_id identity cannot be retargeted through UPDATE.
P3-DB05 Revoked PartnerMembership cannot be reactivated by direct booking_app DML.
P3-DB06 Evidence identity/object key/checksum/uploader provenance cannot be rewritten.
P3-DB07 Partner status history cannot be UPDATEd or DELETEd by booking_app.
P3-DB08 booking_app has exact minimum DML and no excess Partner-table privilege.
P3-DB09 Missing app.tenant_id fails closed for Partner-owned persistence.
P3-DB10 FORCE RLS remains enabled on every Partner-owned table.
```

## Canonical concurrency acceptance mapping

```text
P3-CON01 profile edit vs submit
P3-CON02 payout replacement vs submit
P3-CON03 evidence finalize vs submit
P3-CON04 approve vs request-changes
P3-CON05 approve vs reject
P3-CON06 two concurrent approvals
P3-CON07 stale reviewer expectedVersion vs newer resubmission
P3-CON08 suspend vs cancel
P3-CON09 reactivate vs cancel
P3-CON10 registration verification double-submit
P3-CON11 same verification token consumed concurrently
P3-CON12 distinct concurrent registration attempts for same tenant/email cannot create duplicate establishment
P3-CON13 suspended Partner stale session cannot continue protected use
P3-CON14 revoked PartnerMembership stale session cannot continue protected use
```

Every concurrency case whose correctness depends on row locks, unique constraints, transaction-local RLS, or authorization versions must run against PostgreSQL, not only in-memory fakes.

## Acceptance cross-check against `S3-PARTNER01..18`

The four plans collectively cover the full approved matrix:

```text
S3-PARTNER01 registration enumeration safety -> Plan 3.2
S3-PARTNER02 token binding/single-use/no raw secret -> Plan 3.2
S3-PARTNER03 atomic/idempotent establishment -> Plan 3.2
S3-PARTNER04 canonical global User reuse -> Plan 3.2
S3-PARTNER05 Partner session scope/version binding -> Plan 3.2
S3-PARTNER06 editable states + submitted freeze -> Plan 3.3
S3-PARTNER07 Partner-type completeness -> Plan 3.3
S3-PARTNER08 request-changes/resubmit historical continuity -> Plan 3.4
S3-PARTNER09 approve -> approved + active atomically -> Plan 3.4
S3-PARTNER10 reject preserves historical data -> Plan 3.4
S3-PARTNER11 inactive denied inventory eligibility; active allowed -> Plans 3.1/3.4
S3-PARTNER12 lifecycle + stale Partner authority -> Plan 3.4
S3-PARTNER13 same-tenant Partner A/B resource isolation -> Plans 3.3/3.4
S3-PARTNER14 cross-tenant API/RLS + missing context -> Plans 3.1/3.4
S3-PARTNER15 composite FK/stable identity/revocation -> Plan 3.1
S3-PARTNER16 private evidence/superseding/authorized access -> Plan 3.3
S3-PARTNER17 encrypted/masked payout + no raw leakage -> Plan 3.3
S3-PARTNER18 full concurrency matrix -> Plans 3.2-3.4
```

## Placeholder and interface self-review result

The child-plan migration strings using `<timestamp>` are **templates only** and are fully resolved by the exact migration paths in this index. Example strings such as `<fragment-scrubbed-secret>` or `<tenant-uuid>` are test/example values, not unresolved implementation choices.

No `TODO`/`TBD` or unspecified future implementation is authorized by this plan suite. If execution encounters a required dependency/API not represented by these plans, stop that task, gather repo/library evidence, and amend the plan before production code rather than guessing.

## Handoff gate

Before executing Plan 3.1, verify all of the following:

- PR #32 has actually merged and the new `main` contains its authorization foundation.
- The Sprint 3 implementation branch starts from that updated `main`.
- This index and Plans 3.1-3.4 are present in the worktree.
- The exact migration paths above are unused.
- `pnpm verify:identity-access`, `pnpm verify:dynamic-rbac`, `pnpm verify:migrations`, `pnpm verify:architecture`, API E2E/RLS, and build are green on the starting head.

Then execute Plan 3.1 with strict RED -> GREEN -> focused verification -> commit cadence.
