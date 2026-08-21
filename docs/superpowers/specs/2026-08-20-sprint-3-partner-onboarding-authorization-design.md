# Sprint 3A Partner Onboarding & Authorization Foundation Design

Date: 2026-08-20  
Status: Approved design — repository commit and implementation planning pending  
Owner: partner / identity-access  
Repository baseline: `5fdb8215123400a9d59796f407878d92891261fb`

Depends on:
- `docs/superpowers/specs/2026-08-04-booking-os-pilot-design.md`
- `docs/superpowers/specs/2026-08-05-identity-membership-authorization-core-design.md`
- `docs/superpowers/specs/2026-08-16-sprint-2-tenant-dynamic-rbac-design.md`
- `docs/spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`

Roadmap:
- `docs/plan/90-DAY-EXECUTION.md`

## Summary

Sprint 3A introduces the Partner onboarding and Partner authorization foundation required by the Pilot before Catalog, Availability, Pricing, Booking, Payment, or Finance are opened to external Partner actors.

The slice adds a true third authorization scope, `partner`, alongside the existing `platform` and `tenant` scopes. Partner users reuse the existing global identity, credential, opaque host-bound session, CSRF/origin protection, token hygiene, authorization-version reconciliation, audit, and FORCE-RLS security kernel. Sprint 3A does not create a parallel authentication system.

Partner membership is modeled separately from `TenantMembership`. A user may simultaneously hold tenant staff authority and membership in one or more Partner workspaces. Partner authority is therefore bound through `PartnerMembership`, with its own authorization version, system roles, permissions, lifecycle, invitation flow, and stale-session reconciliation.

The first Partner registrant becomes `partner_owner`. Sprint 3A supports a multi-member foundation from the start using immutable system roles `partner_owner` and `partner_member`, while deferring custom Partner roles and the full three-level Role Builder UI.

The Partner lifecycle distinguishes identity verification from marketplace approval. Verifying an email proves ownership of an identity; it does not make the Partner eligible to create inventory. A Partner must complete the required individual/company verification checklist, submit for review, and be approved by authorized tenant staff before becoming `active`.

Catalog is not implemented in this slice. Sprint 3A exposes a technology-neutral Partner eligibility capability so the later Catalog slice can enforce that only an `active` Partner may create inventory without reading Partner persistence directly.

## Approved Product Decisions

1. Sprint 3A is the first slice inside the roadmap milestone “Sprint 3–5 — Partner, Catalog, Availability and Pricing.”
2. Sprint 3A is limited to Partner onboarding, verification, approval, Partner membership, Partner authorization scope, and the minimum web-console flow required to exercise them end to end.
3. Partner authorization is a true third scope. Partner users are not represented as tenant staff through `TenantMembership`.
4. `PartnerMembership` is the authority membership record for Partner scope and owns its own `authorizationVersion`.
5. A global User may hold tenant staff authority and memberships in multiple Partners without duplicating identity or credentials.
6. Sprint 3A seeds immutable Partner system roles `partner_owner` and `partner_member`.
7. Partner custom roles, Partner Role Builder UI, and arbitrary Partner permission composition remain out of scope.
8. Partner permissions are code-seeded append-only Permission Catalog V2 identifiers and are added only for protected use cases introduced by this slice.
9. Partner registration uses an email verification link and extends the shared identity/session kernel.
10. A Partner registration token never authenticates a user by itself.
11. New-user Partner onboarding uses a single-email continuation flow rather than sending independent activation and Partner-verification messages.
12. Existing active users reuse their existing global identity and credential.
13. Email verification does not imply marketplace approval.
14. Partner lifecycle distinguishes `draft`, `pending_review`, `active`, `inactive`, `suspended`, and `cancelled`.
15. Only `active` Partners are eligible to create inventory.
16. Individual and company Partners use distinct required verification checklists.
17. Automated eKYC, mandatory site visits, and mandatory video verification are outside the Pilot.
18. Tenant staff own the approval decision; Partner users own Partner profile/onboarding data and submission for review.
19. Approval, suspension, membership authority changes, audit, history, and outbox effects are transaction-bound.
20. Partner-owned tables carry `tenant_id` directly and are protected by FORCE RLS using the canonical tenant execution context.
21. Sprint 3A does not add `app.partner_id` as a PostgreSQL RLS variable. Database RLS remains the hard cross-tenant boundary; cross-partner isolation is enforced by authoritative Partner scope and resource-policy application boundaries.
22. Public HTTP registration never accepts a client-supplied `tenantId`; tenant identity is derived from the trusted hostname.
23. Partner workspace routes do not accept a `partnerId` when the Partner can be derived from the current authoritative Partner scope.
24. Tenant operator routes may accept a Partner resource identifier, but only inside the trusted tenant scope and with safe non-leaking lookup semantics.
25. Suspension preserves Partner history, membership history, and future operational obligations. It does not delete inventory or booking history.
26. A final `partner_owner` invariant prevents governance from being orphaned accidentally.
27. Full Listing/Resource CRUD, Availability, Pricing, Booking, Payment, Finance, and Partner custom-role management are not part of Sprint 3A.

## Goals

1. Let a prospective individual or company Partner register from a tenant-owned hostname.
2. Verify the Partner registrant by email using one-time, host-bound, secret-safe verification artifacts.
3. Reuse the existing global identity and opaque-session kernel for new and existing users.
4. Create a Partner aggregate and Partner owner membership without conflating Partner actors with tenant staff.
5. Support a multi-member Partner foundation with `partner_owner` and `partner_member`.
6. Let a Partner complete the Pilot verification checklist and submit for tenant review.
7. Let authorized tenant staff inspect, request changes, approve, reject, and suspend Partner registrations.
8. Make marketplace approval explicit and independent from authentication.
9. Add Partner scope to authoritative authorization contexts and session binding.
10. Reconcile stale Partner sessions after membership authority changes.
11. Protect all tenant-owned Partner persistence with direct `tenant_id` ownership and FORCE RLS.
12. Keep cross-partner access server-authoritative and fail closed.
13. Add stable HTTP/OpenAPI contracts, generated client updates, dedicated Partner acceptance IDs, and a protected verification command.
14. Provide the minimum web-console vertical flow needed to demonstrate registration through approved Partner workspace and member invitation.
15. Expose a Partner eligibility port for the later Catalog slice.

## Non-goals

- Partner custom roles.
- Partner custom role-permission mappings.
- Partner Role Builder UI.
- Platform custom roles.
- Full three-level Platform/Tenant/Partner Role Builder UI.
- Listing or Resource CRUD.
- Catalog publication or moderation.
- Availability, schedules, exceptions, blocks, buffers, or timezone slot generation.
- Pricing or quote snapshots.
- Booking, hold, payment, refund, settlement, ledger, payout, or finance behavior.
- Customer authentication or Customer OTP.
- Social login.
- Automated eKYC.
- Mandatory site visits.
- Mandatory video verification.
- A new Partner-specific credential store.
- Browser-held access tokens or JWTs.
- A Partner verification token that creates a session by itself.
- Client-authoritative `tenantId` or `partnerId`.
- A PostgreSQL `app.partner_id` RLS variable in Sprint 3A.
- Deleting Partner history on rejection, suspension, revocation, or cancellation.
- Pre-seeding future `partner.listing.*`, booking, finance, or other product permissions before those protected use cases exist.

## Baseline Constraints

Sprint 3A extends the verified Sprint 1B and Sprint 2 security direction:

- Global identity remains shared across actor scopes.
- Browser-held access tokens remain prohibited.
- Opaque sessions remain exact-host/host-only.
- The BFF and API continue to derive tenant context from the hostname.
- Unsafe authenticated mutations require the existing CSRF and origin protections.
- `AuthorizationContext` remains backend-authoritative.
- Authorization snapshots reconcile current authority before protected application logic.
- Permission keys remain code-seeded and append-only.
- System roles remain immutable.
- Tenant custom RBAC remains the tenant-level dynamic-RBAC mechanism and is not duplicated for Partner scope in Sprint 3A.
- Tenant-owned persistence remains protected by FORCE RLS.
- Application modules use the existing hexagonal dependency direction.
- Controllers do not query Prisma.
- Application use cases depend on technology-neutral ports.
- Transaction callbacks receive capability ports, not `Prisma.TransactionClient`.
- Supported HTTP operations remain code-first OpenAPI contracts with committed generated artifacts.

## Architecture Decision

Sprint 3A introduces a dedicated Partner module as the owner of Partner lifecycle, Partner verification, Partner membership, Partner review state, Partner eligibility, and Partner-facing HTTP operations.

Conceptually:

```text
apps/api/src/modules/partner/
├── domain/
│   ├── partner.ts
│   ├── partner-membership.ts
│   ├── partner-verification.ts
│   ├── partner-review-policy.ts
│   ├── partner-eligibility-policy.ts
│   └── partner.errors.ts
├── application/
│   ├── ports/
│   │   ├── partner-repository.port.ts
│   │   ├── partner-membership-repository.port.ts
│   │   ├── partner-verification-repository.port.ts
│   │   ├── partner-registration-token.port.ts
│   │   ├── partner-eligibility.port.ts
│   │   ├── partner-audit.port.ts
│   │   └── partner-outbox.port.ts
│   └── use-cases/
│       ├── register-partner.use-case.ts
│       ├── verify-partner-registration.use-case.ts
│       ├── update-partner-profile.use-case.ts
│       ├── submit-partner-review.use-case.ts
│       ├── request-partner-changes.use-case.ts
│       ├── approve-partner.use-case.ts
│       ├── reject-partner.use-case.ts
│       ├── suspend-partner.use-case.ts
│       ├── list-partner-memberships.use-case.ts
│       ├── invite-partner-member.use-case.ts
│       ├── accept-partner-membership.use-case.ts
│       └── revoke-partner-membership.use-case.ts
├── infrastructure/
│   ├── http/
│   ├── persistence/prisma/
│   └── email/
└── partner.module.ts
```

Exact file decomposition may be split further during implementation planning when a unit would otherwise take multiple responsibilities.

### Module ownership

`PartnerModule` owns:

- Partner aggregate lifecycle;
- Partner onboarding/profile state;
- Partner verification checklist;
- Partner review submission state;
- Partner tenant-review actions;
- Partner memberships and membership invitations;
- Partner registration-verification artifacts;
- Partner eligibility policy;
- Partner lifecycle/history;
- Partner-facing and tenant-facing Partner HTTP contracts;
- Partner audit/outbox events.

`Identity/Memberships/Authorization` retain ownership of the shared identity/session/security kernel. Sprint 3A extends their public application contracts only where Partner scope must be represented and reconciled.

`TenancyModule` remains the tenant transaction and FORCE-RLS execution boundary. Partner mutations add only focused Partner capabilities to the transaction session.

Future `CatalogModule` may consume `PartnerEligibilityPort` but must not import Partner Prisma adapters or Partner infrastructure.

## Authorization Scope Model

The authorization context becomes:

```ts
scope:
  | { type: "platform" }
  | {
      type: "tenant";
      tenantId: string;
      tenantSlug: string;
    }
  | {
      type: "partner";
      tenantId: string;
      tenantSlug: string;
      partnerId: string;
    }
```

Partner scope is a first-class authority scope.

`membershipId` and `membershipAuthorizationVersion` remain generic contract fields:

- tenant scope → `TenantMembership`;
- partner scope → `PartnerMembership`.

Partner custom UUIDs or display names do not become role identifiers.

### Partner system roles

Sprint 3A appends immutable system roles:

```text
partner_owner
partner_member
```

These are code-seeded system roles.

The existing global system-role model is extended rather than duplicated:

- `RoleScopeLevel` adds `partner`;
- `Role` continues to hold immutable system roles;
- `Permission.scopeLevel` may be `partner` for Partner-scoped capabilities;
- `RoleAssignment` adds nullable `partnerId` and supports Partner-scoped system-role assignment;
- Partner-scoped assignment requires `scopeLevel = partner`, non-null `tenantId`, and non-null `partnerId`;
- tenant-scoped assignment requires non-null `tenantId` and null `partnerId`;
- platform-scoped assignment requires both `tenantId` and `partnerId` to be null;
- database constraints bind Partner assignments to the same tenant as the referenced Partner.

`PartnerMembership` remains the Partner authority epoch and membership lifecycle record; `RoleAssignment` expresses immutable Partner system-role semantics for that active member. Sprint 3A does not introduce Partner custom-role tables.

### Permission Catalog additions

Tenant-side permissions:

```text
tenant.partner.read
tenant.partner.review
tenant.partner.approve
tenant.partner.suspend
```

Partner-side permissions:

```text
partner.profile.read
partner.profile.update
partner.membership.read
partner.membership.invite
partner.membership.revoke
```

No `partner.listing.*` or later-domain permissions are created in this slice.

`tenant_owner` and `tenant_admin` receive the tenant Partner-management capabilities required by the Pilot according to the final seed mapping. Because Sprint 2 tenant dynamic RBAC already exists, tenant owners may later delegate approved tenant-scoped Partner-management permissions into tenant custom roles subject to the existing grant policy.

Seed mapping for Sprint 3A is explicit:

```text
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

Tenant system-role seed mapping is:

```text
tenant_owner
  tenant.partner.read
  tenant.partner.review
  tenant.partner.approve
  tenant.partner.suspend

tenant_admin
  tenant.partner.read
  tenant.partner.review
  tenant.partner.approve
  tenant.partner.suspend
```

Sensitive Partner membership mutations remain owner-governed in addition to permission checks. Tenant custom-role delegation remains subject to the existing Sprint 2 grant policy.

## Session Model Extension

Session scope types extend from:

```text
platform | tenant
```

to:

```text
platform | tenant | partner
```

Partner-bound session persistence includes `partner_id`.

Database invariants:

```text
platform -> tenant_id NULL, partner_id NULL
tenant   -> tenant_id SET,  partner_id NULL
partner  -> tenant_id SET,  partner_id SET
```

A Partner session is created only after the backend verifies:

```text
current user
+ current tenant host
+ requested Partner selection
+ active PartnerMembership
```

Partner lifecycle state does not authenticate the user. A `draft`, `pending_review`, `inactive`, or `suspended` Partner may still need an authenticated workspace for onboarding, review feedback, or recovery. Product and mutation eligibility are enforced separately by Partner lifecycle/resource policy.

A `partnerId` submitted during workspace selection is a selection hint only. It never becomes authority without authoritative membership resolution.

If a user belongs to multiple Partners, the UI displays a server-derived workspace picker.

Session binding rotates or reissues the opaque session according to the existing session-security rules. No Partner access token is introduced.

## Domain Model

### Partner

`Partner`

- `id` — UUID
- `tenantId` — required UUID
- `type` — `individual | company`
- `displayName`
- legal/business identity fields required by Partner type
- bounded contact fields
- `status` — `draft | pending_review | active | inactive | suspended | cancelled`
- `verificationStatus`
- `payoutAccountStatus`
- `managementRightsStatus`
- optimistic `version`
- `approvedAt`
- `suspendedAt`
- `cancelledAt`
- `createdAt`
- `updatedAt`

Rules:

- Partner identity is a UUID.
- Tenant ownership is direct, not inferred.
- `active` is the only status eligible to create inventory.
- lifecycle changes preserve history.
- suspension does not delete inventory or future obligations.
- approval requires the configured mandatory checks for the Partner type to be accepted.

### PartnerMembership

`PartnerMembership`

- `id`
- `tenantId`
- `partnerId`
- `userId`
- `status` — `invited | active | suspended | revoked`
- `authorizationVersion`
- timestamps

Rules:

- `(partnerId, userId)` is unique for the active membership identity model.
- `(id, tenantId, partnerId)` has a same-tenant/same-Partner integrity path for dependent rows.
- membership authority belongs only to the referenced Partner.
- authority-changing membership operations increment `authorizationVersion`.
- the final active `partner_owner` cannot be revoked/demoted in a way that leaves the Partner without governance.

### PartnerMembershipInvitation

`PartnerMembershipInvitation`

- `id`
- `tenantId`
- `partnerId`
- `normalizedEmail`
- optional `invitedUserId`
- `intendedRoleKey`
- status
- hostname
- selector
- token hash
- expiry/consumption/revocation timestamps
- inviter user/membership identity
- timestamps

Rules:

- only supported Partner system-role invitation intent is allowed in Sprint 3A;
- raw tokens are never persisted;
- invitation acceptance requires authenticated authority;
- duplicate acceptance converges to one active membership;
- invitation acceptance cannot cross tenant or Partner boundaries.

### PartnerRegistrationVerification

A dedicated registration-verification artifact is used instead of overloading tenant membership invitations.

Fields:

- `id`
- `tenantId`
- `partnerId`
- `userId`
- `hostname`
- `selector`
- `tokenHash`
- `expiresAt`
- `consumedAt`
- `revokedAt`
- `createdAt`

Rules:

- token is one-time;
- token is exact tenant-host/user/Partner/purpose bound;
- token never authenticates the user by itself;
- raw token is never stored or logged.

### PartnerVerificationCheck

`PartnerVerificationCheck`

- `id`
- `tenantId`
- `partnerId`
- `checkType`
- `status`
- evidence/document reference
- reviewer identity
- review timestamps
- metadata restricted to non-secret bounded fields

Individual Partner required checks:

```text
identity
payout_account
management_rights
```

Company Partner required checks:

```text
business_registration
payout_account
management_rights
```

Evidence payloads are referenced through storage/document abstractions; Partner domain code does not depend on object-storage implementation details.

### PartnerPayoutAccount

Sprint 3A stores Partner payout-account onboarding and verification state required by the Pilot approval checklist. It does not execute payouts.

Sensitive account values must follow existing encryption/redaction/storage policy and must not be copied into audit metadata.

### PartnerReviewDecision

`PartnerReviewDecision` records each review attempt/result without overloading Partner lifecycle status.

- `id`
- `tenantId`
- `partnerId`
- reviewed Partner `version`
- outcome — `changes_requested | approved | rejected`
- bounded reason/code
- actor identity
- `createdAt`

A new submission produces a new review attempt; prior decisions remain immutable.

### PartnerLifecycleHistory

Lifecycle transitions append immutable history records including:

- tenant;
- Partner;
- previous state;
- next state;
- actor;
- bounded reason/code where applicable;
- timestamp.

History is not deleted when a Partner is rejected, suspended, inactive, or cancelled.

## Partner Lifecycle

Canonical onboarding lifecycle:

```text
draft
  ↓
pending_review
  ↓
active
```

Post-approval lifecycle may move to:

```text
active -> inactive
active -> suspended
active -> cancelled
```

### Draft

Partner owner may complete profile data and required verification evidence.

### Pending review

The Partner has explicitly submitted for tenant review. Fields governed by review consistency may require a new version or explicit return-to-draft/change-request transition before material edits.

### Active

The Partner has been approved by an authorized tenant actor and satisfies the required verification checklist.

Only `active` is inventory-eligible.

### Inactive

Partner remains known and historically valid but is not eligible for new marketplace activity.

### Suspended

Partner authentication may still be possible for recovery/operations, but protected Partner product mutations are denied by Partner eligibility/resource policy. Historical data and future operational obligations remain intact.

### Cancelled

Terminal commercial lifecycle state for the Partner relationship. History remains retained.

## Registration and Identity Flow

Registration always starts on a tenant-owned hostname.

Example:

```text
https://<tenant-host>/partner/register
```

Initial registration collects only the minimum data required to establish the Partner draft and registrant identity:

- email;
- Partner type;
- display name;
- legal/business name when applicable;
- bounded contact details.

The API never accepts a `tenantId`.

### New global user

```text
register
→ create pending global User
→ create draft Partner
→ create invited PartnerMembership(partner_owner)
→ create Partner registration/activation continuation
→ send one onboarding email
→ verify email / activate identity
→ choose password
→ normal authentication
→ activate PartnerMembership
→ enter Partner onboarding workspace
```

The one-email rule may reuse the existing secure activation continuation pattern, but the Partner registration artifact and account activation semantics remain distinct.

The registration token does not bypass password authentication.

### Existing active global user

```text
register
→ create draft Partner
→ create invited PartnerMembership(partner_owner)
→ send Partner verification email
→ verify Partner registration
→ normal password sign-in
→ activate PartnerMembership
→ enter Partner onboarding workspace
```

No new credential is created.

### Identity verification versus Partner approval

After successful identity verification:

```text
User: active
PartnerMembership(owner): active
Partner: draft or pending_review
```

This does not grant inventory eligibility.

The Partner owner may access only the onboarding/review workspace until tenant approval.

## Partner Review Flow

Partner owner completes the required profile/checklist then calls `submitForReview()`.

Submission requires:

- required profile fields;
- required verification evidence for Partner type;
- valid current version;
- no conflicting lifecycle state.

Tenant operations include:

```text
GET  /tenant/partners
GET  /tenant/partners/:partnerId
POST /tenant/partners/:partnerId/request-changes
POST /tenant/partners/:partnerId/approve
POST /tenant/partners/:partnerId/reject
POST /tenant/partners/:partnerId/suspend
```

### Request changes

A tenant actor may return a submission for correction without forcing re-registration.

The Partner transitions `pending_review -> draft`. An immutable review-decision record stores `changes_requested`, actor, bounded reason, and version. The Partner may update allowed fields/evidence and resubmit.

### Approval

`approvePartner()` atomically:

```text
lock Partner
validate pending_review
validate expected version
validate required checks accepted
set status = active
record approval metadata
append lifecycle history
append bounded audit
append outbox event
commit
```

Any failure in the authority/lifecycle transaction rolls the operation back.

### Rejection

`reject` is a review outcome, not a separate long-lived Partner status in Sprint 3A. The Partner transitions `pending_review -> draft`, while an immutable review-decision record stores `rejected`, actor, bounded reason, and the reviewed Partner version.

Rejection does not delete Partner data or verification history. A later resubmission creates a new review attempt/history entry rather than overwriting the prior rejection.

### Suspension

Suspension changes Partner eligibility immediately and transactionally.

When a Partner lifecycle transition changes effective Partner authority (`active`, `inactive`, `suspended`, or `cancelled` boundaries), the transaction deterministically locks active Partner memberships and increments each affected `PartnerMembership.authorizationVersion` exactly once. Existing session reconciliation then rejects stale authority before protected Partner application logic.

It does not delete Partner membership or historical obligations.

Future Catalog/Booking slices must enforce the specific consequences for existing inventory and confirmed bookings.

## Partner Eligibility Contract

Partner owns a technology-neutral contract:

```ts
interface PartnerEligibilityPort {
  canCreateInventory(input: {
    tenantId: string;
    partnerId: string;
  }): Promise<boolean>;
}
```

The effective rule for Sprint 3A is:

```text
Partner.status == active
```

Future product rules may refine eligibility through dated designs without requiring Catalog to import Partner persistence.

Catalog must depend on this contract rather than reading Partner tables directly.

## Partner Member Invitation

Only an authorized `partner_owner` of an eligible Partner workspace may invite members in Sprint 3A.

Flow:

```text
partner_owner
→ invite email
→ one-time PartnerMembershipInvitation
→ existing/new User identity continuation
→ authenticated acceptance
→ active PartnerMembership
→ partner_member system role
→ membership authorization version bound to Partner session
```

The invitation token alone cannot create a session.

Partner member invitation secrets follow the same token-hygiene rules as existing identity flows:

- fragment transport for browser entry;
- immediate fragment stripping;
- no query-string secrets;
- no localStorage/sessionStorage persistence;
- no raw token logging;
- no audit-token leakage;
- hash-only persistence;
- expiry and single-use semantics.

## HTTP Boundaries

### Public Partner onboarding

```text
POST /partner/registrations
POST /partner/registrations/verify
POST /partner/registrations/resend-verification
```

Properties:

- tenant from hostname;
- no client `tenantId`;
- bounded payload;
- normalized email;
- same-origin;
- rate limited;
- enumeration safe;
- verification responses are secret-safe and no-store where appropriate.

### Tenant Partner operations

```text
GET  /tenant/partners
GET  /tenant/partners/:partnerId
POST /tenant/partners/:partnerId/request-changes
POST /tenant/partners/:partnerId/approve
POST /tenant/partners/:partnerId/reject
POST /tenant/partners/:partnerId/suspend
```

Properties:

- exact tenant session required;
- explicit tenant Partner-management permission required;
- tenant derived from authoritative context;
- `partnerId` is only a resource selector inside the trusted tenant;
- foreign/inaccessible Partner identifiers do not leak existence.

### Partner workspace

```text
GET    /partner/profile
PATCH  /partner/profile
POST   /partner/review-submission
GET    /partner/memberships
POST   /partner/memberships/invitations
DELETE /partner/memberships/:membershipId
```

Partner self routes do not accept `partnerId`.

The Partner comes from:

```text
authorizationContext.scope.partnerId
```

### Partner scope selection

A normal authenticated user may request selection of a Partner workspace:

```text
POST /auth/session/partner-scope
{
  partnerId
}
```

The submitted `partnerId` is a selection hint only.

The backend must verify active same-user/same-tenant Partner membership before binding the session.

## HTTP Error Model

Stable HTTP semantics:

```text
400 malformed transport or invalid verification artifact
401 authentication required
403 authenticated but authority/governance denied
404 inaccessible Partner/member/resource
409 lifecycle/version/concurrency conflict
422 valid transport but business requirements incomplete
429 registration/resend abuse limit
```

Stable machine-code examples:

```text
PARTNER_REGISTRATION_VERIFICATION_INVALID
PARTNER_NOT_FOUND
PARTNER_STATE_CONFLICT
PARTNER_REVIEW_REQUIREMENTS_INCOMPLETE
PARTNER_MEMBERSHIP_NOT_FOUND
PARTNER_MEMBERSHIP_LAST_OWNER
PARTNER_ACCESS_DENIED
```

Responses must not expose:

- SQL;
- Prisma errors;
- constraint names;
- foreign-tenant existence;
- raw tokens;
- payout secrets;
- sensitive evidence URLs.

Unsafe authenticated mutations use the existing CSRF/origin security boundary.

## Persistence and FORCE RLS

All tenant-owned Partner records carry `tenant_id` directly.

The migration must add:

- composite same-tenant foreign keys;
- indexes for lifecycle/review/member lookup;
- FORCE RLS on all tenant-owned Partner tables;
- exact application-role grants;
- migration verification and schema-drift coverage.

Sprint 3A intentionally does not add `app.partner_id` to the PostgreSQL RLS contract.

Isolation layers are:

```text
PostgreSQL FORCE RLS
    ↓
hard cross-tenant isolation

authoritative partner AuthorizationContext
    ↓
cross-partner resource isolation
```

Partner application persistence methods that operate on current Partner scope receive trusted `partnerId` from the authoritative context/capability session, not from browser input.

Tenant operator use cases may select Partner resources inside the tenant transaction.

## Transaction and Concurrency Rules

The following mutations are atomic authority/lifecycle operations:

- Partner approval;
- Partner suspension;
- PartnerMembership activation;
- PartnerMembership revocation;
- Partner lifecycle transitions that change effective product authority;
- Partner member invitation acceptance;
- final-owner-protected owner membership mutations.

Each transaction contains the required combination of:

```text
state mutation
authorization-version bump when authority changes
history
audit
outbox
```

A required audit/outbox failure rolls back the business mutation.

### Required race semantics

Acceptance must prove:

- duplicate registration for the same tenant/email converges safely;
- the same email may register in different tenants independently;
- approve versus request-changes has one deterministic winner;
- approve versus suspend has one deterministic serialized result;
- duplicate member invitation acceptance creates one active membership;
- invite versus inviter revoke/suspension fails closed when inviter authority is no longer valid;
- Partner membership revoke bumps authorization version and stale Partner authority cannot execute protected logic;
- Partner lifecycle authority changes bump affected active Partner membership versions exactly once;
- Partner suspension prevents stale active Partner mutation authority;
- final Partner owner concurrency cannot leave the Partner without an owner.

Optimistic versions or equivalent precondition checks must prevent silent last-write-wins lifecycle updates.

## Audit and Outbox Events

Bounded events include:

```text
partner.registration.created
partner.registration.email_verified
partner.review.submitted
partner.review.changes_requested
partner.approved
partner.rejected
partner.suspended
partner.membership.invited
partner.membership.accepted
partner.membership.revoked
```

Audit/outbox metadata must not contain:

- raw verification tokens;
- raw invitation tokens;
- full payout credentials;
- secret-bearing evidence URLs;
- passwords;
- session tokens.

## OpenAPI and Generated Client

NestJS controllers, named request/response models, and route decorators remain the supported HTTP source of truth.

Sprint 3A must:

- use stable operation IDs;
- use explicit domain tags;
- use named schemas;
- classify supported routes correctly;
- generate deterministic OpenAPI;
- commit generated OpenAPI and API-client artifacts;
- pass generated-drift checks;
- pass compatibility checks with only intentional additive contract changes unless an explicitly reviewed compatibility amendment says otherwise.

Generated files are never hand-maintained as source contracts.

## Minimum Web Console Vertical Slice

Sprint 3A is not backend-only.

Minimum Partner UI:

```text
/partner/register
/partner/verify
/partner/onboarding
/partner/review-status
/partner/members
```

Minimum tenant Partner-operations UI:

```text
/partners
/partners/:id
```

The final browser flow must demonstrate:

```text
register
→ verify
→ activate/sign in
→ complete Partner profile/checklist
→ submit for review
→ tenant reviews
→ tenant approves
→ Partner enters active workspace
→ owner invites member
→ member accepts
```

UI for Listing/Resource/Availability/Pricing is deferred.

## Acceptance Matrix

Canonical acceptance IDs are `S3-PARTNER01` through `S3-PARTNER20`.

| ID | Acceptance |
|---|---|
| S3-PARTNER01 | New-user Partner registration creates one tenant-bound draft Partner and owner-membership intent. |
| S3-PARTNER02 | Existing global User registration reuses identity and credential. |
| S3-PARTNER03 | Duplicate same-tenant/email registration is safe, bounded, and enumeration-safe. |
| S3-PARTNER04 | The same email may register independently across tenants without authority bleed. |
| S3-PARTNER05 | Registration-verification tokens are hashed, expiring, one-time, and secret-safe. |
| S3-PARTNER06 | Registration verification is exact-host/tenant/user/Partner/purpose bound. |
| S3-PARTNER07 | New-user onboarding sends one message and reuses the normal activation/login kernel without token-auth bypass. |
| S3-PARTNER08 | Verified identity does not imply Partner marketplace approval or inventory eligibility. |
| S3-PARTNER09 | Individual/company required verification checklists are enforced. |
| S3-PARTNER10 | Incomplete Partner onboarding cannot submit for tenant review. |
| S3-PARTNER11 | Approval validates required checks and commits lifecycle/audit/outbox atomically. |
| S3-PARTNER12 | Request-changes/reject preserves history and supports controlled recovery/resubmission. |
| S3-PARTNER13 | Approve/request-changes/suspend races serialize deterministically with stale versions rejected. |
| S3-PARTNER14 | Partner session binds only an active same-user/same-tenant PartnerMembership. |
| S3-PARTNER15 | Partner scope cannot access another Partner in the same tenant. |
| S3-PARTNER16 | Member invitation/acceptance creates exactly one active PartnerMembership. |
| S3-PARTNER17 | Final `partner_owner` protection prevents orphaned Partner governance under normal and concurrent mutation. |
| S3-PARTNER18 | Membership revoke/authority change increments the Partner membership authority epoch and stale Partner sessions fail before protected logic. |
| S3-PARTNER19 | Partner suspension blocks protected Partner mutations without deleting membership or history. |
| S3-PARTNER20 | FORCE RLS, migration, architecture, Sprint 1B identity, Sprint 2 dynamic RBAC, OpenAPI, build, browser, production-config, dependency-audit, and secret-scan regressions remain green. |

## Dedicated Verification Gate

Add root command:

```text
pnpm verify:partner-onboarding
```

The verifier must map `S3-PARTNER01`–`S3-PARTNER20` to executable test/gate evidence.

It must not pass by merely finding acceptance-ID strings.

Protected ordering:

```text
migrations
→ verify:identity-access
→ verify:dynamic-rbac
→ verify:partner-onboarding
→ architecture
→ OpenAPI
→ build
→ browser smoke
→ production configuration
→ dependency audit
→ committed-secret scan
```

Exact CI job decomposition is implementation-planning detail, but the regression ordering and blocking behavior are normative.

## Definition of Done

Sprint 3A is technical-complete when:

- Partner domain, membership, registration-verification, verification-checklist, lifecycle/history, and payout-onboarding persistence exist.
- Migrations are drift-clean and all tenant-owned Partner tables are directly tenant-owned and FORCE-RLS protected.
- `partner` is a supported authorization/session scope.
- Partner session persistence and authoritative context carry trusted `partnerId`.
- `partner_owner` and `partner_member` are immutable system roles.
- Sprint 3A tenant/Partner Permission Catalog additions are code-seeded and append-only.
- new-user and existing-user Partner registration flows are green.
- one-email new-user Partner onboarding is green without authentication bypass.
- tenant review, request-changes, approval, reject, and suspension behavior are green.
- Partner profile/onboarding and member invitation flows are green.
- final Partner-owner protection is green.
- Partner membership authorization-version reconciliation rejects stale authority before protected application work.
- audit/history/outbox behavior is atomic, bounded, and secret-safe.
- tenant and cross-partner isolation acceptance is green.
- supported HTTP/OpenAPI contracts and committed generated client artifacts are current.
- `S3-PARTNER01`–`S3-PARTNER20` are executable through `pnpm verify:partner-onboarding`.
- Sprint 1B identity-access and Sprint 2 dynamic-RBAC protected regressions remain green.
- minimum web-console vertical E2E passes.
- Partner eligibility is exposed through a technology-neutral port for the next Catalog slice.
- no Partner custom Role Builder, Listing, Availability, Pricing, Booking, Payment, or Finance implementation has been accidentally pulled into scope.

## Deferred Work

### Next Catalog slice

The next slice may introduce:

- Listing type;
- Listing group;
- Listing;
- Resource;
- Catalog permissions;
- Partner inventory operations;
- tenant moderation/publication;
- media;
- active-Partner eligibility enforcement.

It must consume the Partner eligibility contract rather than bypass Partner ownership.

### Later Partner RBAC

Partner custom roles may be introduced only when real Partner product flows need dynamic Partner permission composition and after grant-policy/audit/concurrency requirements are explicitly designed.

### Later booking/operations implications

Partner suspension effects on existing published listings, future confirmed bookings, disputes, settlement, and payout are defined by those later bounded modules. Sprint 3A preserves the lifecycle signal and does not silently delete obligations.

## Review Boundary

Approval of this design authorizes transition to a written implementation plan only after the spec itself has been reviewed.

It does not authorize:

- GitHub commit/push;
- creation or update of a pull request;
- marking an existing PR ready;
- requesting reviewers;
- merging;
- production deployment.

Repository writes remain separately authorized actions.
