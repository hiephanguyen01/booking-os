# Sprint 3 Partner Foundation and Onboarding Design

Date: 2026-08-22  
Status: Design approved in conversation; written spec pending user review  
Owner: partner / identity-access / authorization  
Repository: `hiephanguyen01/booking-os`  
Design branch: `docs/sprint-3-partner-foundation-design`  
Baseline: Sprint 2 draft head `a6f9c23a9d8a015e514684527044e7deccefc9b9`  
Depends on: Sprint 1B identity/session/authorization kernel, Sprint 2 tenant dynamic RBAC, tenant FORCE-RLS transaction boundary, OpenAPI/generated-client and architecture gates

## 1. Purpose

Sprint 3 creates the first production-shaped Partner actor scope for Booking OS. The slice lets an external Partner register by email verification link, establish a Partner account on the shared global identity/session kernel, complete an individual or company onboarding application, submit evidence and payout-account data, receive tenant review, and become an approved operational Partner without creating a parallel authentication stack or weakening tenant isolation.

The exit of this sprint is an approved, active, securely authorized Partner that is ready to own inventory in the next product slice. Sprint 3 deliberately does not implement listings, resources, schedules, availability, pricing, publication, booking, payment, settlement, or the full Partner Role Builder UI.

The delivery path is:

```text
Partner registration
→ email verification
→ global identity reuse/activation
→ Partner + PartnerMembership establishment
→ Partner-scoped session
→ onboarding profile/evidence/payout account
→ submit
→ tenant verification/review / changes requested
→ approve
→ operationally active Partner
```

## 2. Source hierarchy and roadmap reconciliation

This design follows the active delivery-source hierarchy in `docs/governance/DELIVERY-RECONCILIATION.md`:

1. approved dated amendments and ADRs;
2. active architecture/design decisions;
3. active implementation plan and current task;
4. current code/tests/migrations/contracts;
5. historical plans/checkpoints as prior-state evidence.

Current high-level roadmap (`docs/plan/90-DAY-EXECUTION.md`) groups Sprint 3–5 as Partner, Catalog, Availability and Pricing. The older Pilot Design uses an earlier numbering where Partner Onboarding is named Sprint 2 and Bookable Inventory is named Sprint 3. Those sources describe a coherent delivery sequence but use different milestone numbering.

Classification:

- the old sprint numbering is `STALE_METADATA` relative to the current 90-day roadmap;
- the absence of a dedicated active Sprint 3 Partner implementation plan before this design is a `ROADMAP_GAP`;
- listing/resource/scheduling/pricing are `EXPECTED_INCOMPLETE` until later slices;
- this is not a production implementation conflict.

The 2026-08-10 identity/authorization amendment is authoritative for Partner authentication and authorization: Partner registration uses an email verification link, reuses the shared identity/session kernel, and introduces Partner authorization scope with Partner delivery rather than creating a separate auth system.

## 3. Goals

Sprint 3 must:

1. add Partner as a first-class authorization scope alongside Platform and Tenant;
2. preserve one global User identity per normalized email;
3. support public Partner registration using a secure email verification link;
4. reuse shared password, opaque-session, hostname, CSRF, token-secrecy, authorization-version, audit, and abuse-protection invariants;
5. create a Partner aggregate supporting `individual` and `company` applications;
6. let a Partner edit a draft/changes-requested application, submit it, and inspect review findings/verification state;
7. let authorized tenant operators review verification items, request changes, approve, or reject the application;
8. activate inventory eligibility only after approval;
9. support Partner suspend/reactivate/cancel lifecycle operations with owner-governed authority;
10. make Partner-owned persistence tenant-owned, same-tenant constrained, and FORCE-RLS protected;
11. keep same-tenant Partner-vs-Partner access behind authoritative resource policy;
12. keep evidence private and payout data encrypted/masked;
13. prove required state, concurrency, stale-authority, RLS, minimum-DML, and secret-safety behavior with executable acceptance tests;
14. preserve every Sprint 1B and Sprint 2 protected regression gate.

## 4. Non-goals

The following are explicitly outside Sprint 3:

- listing type, listing group, listing, resource, media-publication, moderation, search, or storefront inventory;
- schedule, exception, resource block, buffer, slot generation, Redis booking hold, or availability calculation;
- pricing rules, quote snapshots, promotion logic, commission settlement, booking, payment, refund, ledger, payout execution, or reconciliation;
- Customer authentication or Customer Email OTP delivery;
- Partner custom roles or a full Partner Role Builder UI;
- Platform custom roles;
- Partner team invitation/member-management product UI;
- automatic eKYC, mandatory video verification, or mandatory physical site visits;
- public object-storage URLs for verification evidence;
- tenant-level subscription, plan, or entitlement implementation unless a later explicit plan schedules it;
- partner-level PostgreSQL RLS using `app.partner_id`;
- automatic destructive correction of historical Partner records.

`partner_admin` is introduced as an immutable Partner system-role foundation for future Partner team-management flows, but Sprint 3 does not expose a public use case for inviting or granting additional Partner members.

## 5. Architecture

Booking OS remains a modular monolith. New Partner business code follows ADR-0007 minimal hexagonal boundaries:

```text
apps/api/src/modules/partners/
├── domain/
├── application/
│   ├── ports/
│   └── use-cases/
├── infrastructure/
│   ├── http/
│   ├── persistence/
│   ├── storage/
│   └── crypto/
├── partners.tokens.ts
└── partners.module.ts
```

Dependency direction:

```text
infrastructure → application → domain
composition root → all zones in its own module
```

Rules:

- Partner domain code imports no NestJS, Prisma, HTTP, object-storage SDK, logger, queue, environment, or crypto-provider types.
- Partner application ports expose no Prisma transaction client, Express/Fastify types, provider SDK objects, or signed-URL implementation details.
- Controllers invoke application use cases only.
- Partner adapters may consume exported Identity/Sessions/Authorization application contracts but never import another module's infrastructure directory.
- Another module may consume Partner behavior only through explicit application-facing contracts.
- Existing foundation code is touched only where the Partner scope genuinely extends the shared kernel.

### 5.1 Module ownership

`IdentityModule` continues to own:

- global User identity;
- normalized email identity;
- password credentials;
- password reset and password-policy behavior;
- secure token/hash primitives exposed through application ports.

`SessionsModule` continues to own:

- opaque sessions and session-token rotation;
- host-only `__Host-` cookie semantics;
- session reuse detection, revocation, expiry, and scope reconciliation.

`AuthorizationModule` continues to own:

- current-scope authoritative authorization context;
- permission evaluation;
- resource-policy execution;
- stale-authority reconciliation before protected use cases.

`PartnersModule` owns:

- Partner aggregate and lifecycle;
- PartnerRegistration, PartnerMembership, and PartnerRoleAssignment persistence;
- Partner application/profile;
- Partner verification records and tenant verification decisions;
- Partner review findings;
- Partner evidence metadata and storage authorization;
- Partner payout-account metadata and encryption port usage;
- Partner application/review/lifecycle use cases;
- Partner-specific audit/history/outbox semantics.

## 6. Actor and scope model

### 6.1 Partner is a separate authorization scope

Partner is an actor scope nested under a Tenant resource boundary, not a TenantMembership subtype and not a new tenant.

```text
Global User
   │
   ├── optional TenantMembership(s)      ← tenant staff scope
   │
   └── PartnerMembership(s)              ← external Partner scope
           │
           └── Partner
                └── tenant_id
```

A critical correction from the early design discussion is explicit here: `PartnerMembership` references the global `User` directly. It does **not** require or create a `TenantMembership`. External marketplace Partners must not become tenant administrative members merely because they register as Partner actors.

A User may independently be:

- tenant staff only;
- Partner only;
- both tenant staff and Partner;
- a member of multiple Partners, where later product policy allows it.

Those authorities remain isolated by current scope.

### 6.2 Scope enums

Extend the shared scope catalogs:

```text
IdentityScopeType:
  platform
  tenant
  partner

RoleScopeLevel:
  platform
  tenant
  partner
```

The enum addition does not by itself widen every existing identity token flow. Existing account-activation/password-reset flows keep their current allowed scope shapes until an explicit Partner recovery/activation contract needs otherwise. Partner registration uses the dedicated registration/continuation contract in this design rather than relying on a pre-existing TenantMembership activation token.

### 6.3 Current-scope-only authority

A Partner session never unions Tenant permissions into Partner permissions, even when the same User also has an active TenantMembership.

```text
partner session authority
= active global User
+ exact trusted hostname / tenant
+ active Partner
+ active PartnerMembership
+ active Partner system-role assignments
+ Partner-scope permissions
+ Partner resource/lifecycle policy
```

A Tenant session continues to use TenantMembership authority and never inherits Partner permissions.

If a dual-role user needs to switch between Tenant and Partner scope on the same hostname, scope switching must be explicit and rotate session material. The browser has one current authoritative scope per active cookie context; scope switching must not preserve or union permissions from the previous scope.

### 6.4 Partner session snapshot

Partner-scoped `AuthSession` extends the existing session model with:

```text
scope_type = partner
tenant_id   = required
partner_id  = required

user_authorization_version
partner_authorization_version
partner_membership_authorization_version
```

Partner scope does not require `TenantMembership.authorization_version`.

Required session scope-shape constraint:

```text
platform: tenant_id IS NULL     AND partner_id IS NULL
tenant:   tenant_id IS NOT NULL AND partner_id IS NULL
partner:  tenant_id IS NOT NULL AND partner_id IS NOT NULL
```

`AuthSessionToken` carries/validates matching scope and tenant/partner shape where the existing duplicated scope fields are retained. Wrong-host, wrong-tenant, wrong-partner, wrong-scope, stale-version, suspended/cancelled Partner, inactive PartnerMembership, or inactive User fail before product use-case execution.

### 6.5 Generic system-role assignment boundary

Partner system roles are **not** assigned through the existing generic `role_assignments` table. That table remains the Platform/Tenant system-role assignment mechanism. Sprint 3 adds `partner_role_assignments`, tied structurally to `PartnerMembership`.

Database/catalog verification must reject Partner-scope roles in generic `role_assignments`, and must reject Platform/Tenant roles in `partner_role_assignments`. This prevents a Partner role from becoming ambient User/Tenant authority.

## 7. Partner registration and identity establishment

### 7.1 Public registration contract

Partner registration is available only on a trusted, active tenant hostname. Tenant identity comes from host resolution and is never supplied as a public request authority field.

The public start endpoint is enumeration-safe:

```text
POST /partner-registration/start
```

Input contains the registration email plus the minimal request data required to send a verification link. The public response never reveals whether the email already belongs to a global User, existing Partner, pending registration, or ineligible account.

Canonical response intent:

```text
If the address can be used for Partner registration,
verification instructions will be sent.
```

### 7.2 PartnerRegistration record

Partner registration has a durable tenant-owned intent record with a single-use email secret and a separately rotated single-use continuation secret:

```text
PartnerRegistration
├── id
├── tenant_id
├── normalized_email
├── hostname
├── status: pending_email | email_verified | completed | revoked | expired
├── email_selector
├── email_token_hash
├── email_expires_at
├── email_consumed_at
├── continuation_selector
├── continuation_token_hash
├── continuation_expires_at
├── continuation_consumed_at
├── verified_at
├── completed_at
└── created_at
```

Raw email/continuation secrets are never stored. Selector + keyed digest/hash is stored at rest.

Starting a registration does not create a global User row for an unverified email. New global identity creation is deferred until verified registration continuation, preventing unauthenticated requests from filling the global User table with arbitrary third-party emails.

### 7.3 Email verification exchange

The email verification secret is:

- single-use;
- short-lived;
- hostname-bound;
- tenant-bound;
- purpose-bound to Partner registration;
- excluded from logs, audit, metrics, persistence, and referrers.

Email links place the raw secret in a browser fragment where feasible:

```text
https://<tenant-host>/partner/register/verify#<secret>
```

The browser/BFF scrubs the fragment before normal navigation, referrer, analytics, or server access logging, then performs the same-origin exchange.

Successful exchange atomically:

1. locks the PartnerRegistration;
2. validates and consumes the email token;
3. sets registration status to `email_verified` and `verified_at`;
4. rotates to a new short-lived registration continuation selector/hash;
5. returns the raw continuation only through a host-only, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no-`Domain` continuation cookie owned by the same-origin flow.

The email secret cannot be exchanged twice. The continuation is a separate secret and is consumed only when Partner establishment commits.

### 7.4 Existing-user and new-user branches

Email ownership and account authentication are distinct.

**Existing active User:**

- email verification proves control of the registration email;
- the registration continuation alone does not mint a full session for an existing active account;
- the actor authenticates using the normal shared credential/session flow;
- password-reset uses the existing recovery flow when needed;
- completion requires both the authenticated User and a valid registration continuation whose normalized email matches that User.

**New User:**

- email verification plus the valid continuation authorizes the new-account setup path;
- IdentityModule applies the existing password policy and creates/activates the global User through an exported application contract;
- account setup may commit before Partner establishment; an active global User without a Partner is safe and the still-valid continuation permits retry;
- Partner establishment requires an authenticated session for the newly established User plus the matching continuation.

The design deliberately does not require global identity creation and Partner establishment to be one cross-module database transaction. The security invariant is instead that Partner establishment itself is atomic and retryable, while a failed Partner transaction never consumes the continuation.

### 7.5 Atomic Partner establishment

`CompletePartnerRegistration` requires:

- active trusted tenant;
- valid authenticated global User;
- valid, unconsumed registration continuation on the same host/tenant;
- normalized registration email matching the authenticated User;
- registration not already completed/revoked/expired.

One Partner transaction atomically:

```text
consume registration continuation
+ mark PartnerRegistration completed
+ create Partner
+ create active initial PartnerMembership
+ create partner_owner PartnerRoleAssignment
+ append initial Partner/application history
+ append required audit
+ append required outbox
```

The transaction is idempotent under concurrent completion. It cannot leave:

- a Partner with no initial owner membership;
- an owner membership pointing at a different tenant/Partner;
- duplicate Partner establishment for one registration;
- a consumed continuation when the Partner transaction rolled back.

Partner session issue/scope rotation happens only after this transaction commits.

## 8. Domain model

### 8.1 Partner aggregate root

```text
Partner
├── id
├── tenant_id
├── type: individual | company
├── application_status
├── operational_status
├── version
├── authorization_version
├── submitted_at
├── approved_at
├── suspended_at
├── cancelled_at
├── created_at
└── updated_at
```

`id` and `tenant_id` are stable identities. `version >= 1`. `authorization_version >= 1`.

### 8.2 Application lifecycle

```text
draft
  │ submit
  ▼
submitted
  ├──────────► changes_requested
  │                  │
  │                  │ resubmit
  │                  ▼
  │              submitted
  │
  ├──────────► approved
  │
  └──────────► rejected
```

Rules:

- `draft` and `changes_requested` permit Partner-owned application edits.
- `submitted` freezes Partner-owned review material against self-service mutation.
- tenant reviewers may update verification decisions while the application is `submitted`.
- `changes_requested` reopens Partner-owned application fields while preserving review history.
- `approved` is terminal for the original onboarding application.
- `rejected` is terminal for the original onboarding application.
- post-approval material business-information changes are handled by future explicit amendment/re-verification workflows rather than rewriting onboarding history.

### 8.3 Operational lifecycle

```text
inactive
   │ approval
   ▼
 active
   │
   ├──── suspend ───► suspended
   │                    │
   │                    └── reactivate ─► active
   │
   └──── cancel ─────► cancelled

suspended ── cancel ─► cancelled
```

Rules:

- new Partners start `inactive`;
- approval atomically moves `application_status: submitted → approved` and `operational_status: inactive → active`;
- only `active` Partners may pass future inventory-operating lifecycle policy;
- `suspended` Partners retain historical data but cannot exercise operational Partner product authority;
- `cancelled` is terminal;
- `cancelled → active|suspended|inactive` is forbidden.

### 8.4 Partner profile

`PartnerProfile` is one current application-owned profile per Partner. The exact field set is split by Partner type but minimally covers:

**Individual:**

- legal/display identity information;
- contact information;
- declarations required for application submission.

**Company:**

- legal/business registration information;
- authorized representative;
- contact information;
- declarations required for application submission.

Application domain validation, not database triggers, determines which fields are required by type.

### 8.5 Partner verification items

```text
PartnerVerificationItem
├── id
├── tenant_id
├── partner_id
├── kind
├── status
├── version
├── reviewed_by_user_id
├── reviewed_at
├── reason_code
├── created_at
└── updated_at
```

Required initial kinds:

```text
identity
business_registration
payout_account
management_rights
```

A type-specific policy determines required kinds. `business_registration` is required for company applications and not required for individual applications unless later policy changes.

Status:

```text
pending
verified
changes_required
rejected
```

Only authorized tenant review use cases may mark a verification item `verified`, `changes_required`, or `rejected`. Partner self-service never directly chooses verification status.

When an editable application replaces evidence or payout-account material for a kind, the corresponding verification item is reset to `pending` in the same application transaction. Approval requires every type-required verification item to be `verified`.

### 8.6 Partner review findings

```text
PartnerReviewFinding
├── id
├── tenant_id
├── partner_id
├── category
├── code
├── message
├── created_by_user_id
├── created_at
├── resolved_at
└── resolved_by_submission_version
```

Reviewer-authored category/code/message/author/timestamp are immutable. Resolution metadata may be updated by the review workflow. Partner self-service cannot rewrite tenant reviewer findings.

### 8.7 Partner evidence

```text
PartnerEvidence
├── id
├── tenant_id
├── partner_id
├── verification_kind
├── object_key
├── original_filename_display
├── content_type
├── size_bytes
├── sha256
├── scan_status
├── uploaded_by_user_id
├── created_at
└── superseded_at
```

Evidence replacement is append/supersede, never object-key overwrite.

### 8.8 Partner payout account

```text
PartnerPayoutAccount
├── id
├── tenant_id
├── partner_id
├── bank_code
├── account_holder_name
├── account_number_ciphertext
├── account_number_last4
├── account_number_fingerprint
├── encryption_key_version
├── version
├── created_at
└── superseded_at
```

Only one non-superseded payout account exists per Partner. Replacement creates a new record and supersedes the old one.

Payout verification state is **not duplicated** on this table. `PartnerVerificationItem(kind = payout_account)` is the canonical verification state. Read DTOs may compose that status from the verification item.

### 8.9 Partner membership

```text
PartnerMembership
├── id
├── tenant_id
├── partner_id
├── user_id
├── status
├── authorization_version
├── created_at
├── suspended_at
└── revoked_at
```

Status vocabulary is reserved for Partner member-management evolution:

```text
active
suspended
revoked
```

Sprint 3 public flows create only the initial active owner membership. Sprint 3 exposes no Partner member suspend/revoke/invite endpoint. Active PartnerMembership means the user may enter the Partner scope; it does not imply the Partner is operationally active.

The authority invariant is:

```text
authenticated Partner scope
AND active PartnerMembership
AND required Partner permission
AND same-Partner resource policy
AND Partner operational/lifecycle eligibility
```

### 8.10 Partner system-role assignment

Partner roles are immutable system roles in the code-seeded/global Role catalog:

```text
partner_owner
partner_admin
```

A dedicated tenant-owned assignment table ties system role authority to PartnerMembership:

```text
PartnerRoleAssignment
├── id
├── tenant_id
├── partner_id
├── partner_membership_id
├── role_id
├── created_at
└── revoked_at
```

The database/application validates that the assigned Role has `scope_level = partner` and is an approved system role. Partner custom-role tables are deferred.

Sprint 3 creates only the initiating `partner_owner` assignment through the public product flow. `partner_admin` is seeded as the Partner system-role foundation but no Sprint 3 team-management endpoint grants additional memberships or role assignments.

### 8.11 Partner status history

```text
PartnerStatusHistory
├── id
├── tenant_id
├── partner_id
├── dimension: application | operational
├── from_status
├── to_status
├── actor_user_id
├── reason_code
└── created_at
```

History is append-only and is not the current authority source. Current state lives on `Partner`.

## 9. Submission, verification, and review rules

### 9.1 Submit eligibility

Submit means the application is complete enough for tenant review, not that verification has already succeeded.

Individual application submission requires:

- required individual profile fields;
- contact data;
- current payout-account record;
- identity evidence/metadata;
- management-rights evidence/metadata;
- required declarations.

Company submission requires:

- legal/business profile fields;
- representative/contact data;
- current payout-account record;
- business-registration evidence/metadata;
- management-rights evidence/metadata;
- required declarations.

Missing requirements reject deterministically without partial mutation.

### 9.2 Submitted application freeze

Once submitted, Partner self-service cannot alter review-relevant profile, payout, or evidence data until the tenant requests changes. Tenant reviewers may record verification decisions/findings while the submission remains frozen. This makes a submission version reviewable as a coherent snapshot.

### 9.3 Tenant verification decisions

Tenant review use cases own verification status transitions:

```text
pending → verified
pending → changes_required
pending → rejected
changes_required → verified      (after Partner correction/resubmission)
changes_required → rejected
```

Each decision requires:

- same-tenant Partner resource access;
- `tenant.partner.verification.review`;
- expected verification-item version;
- bounded reason code/message for `changes_required` or `rejected`;
- audit metadata with no evidence binary or payout secret.

Marking an item `changes_required` does not itself unlock Partner editing. `RequestPartnerChanges` is the aggregate command that transitions the application to `changes_requested` after findings/verification decisions are recorded.

### 9.4 Request changes

`RequestPartnerChanges`:

- requires current `submitted` state;
- requires at least one actionable review finding or `changes_required` verification item;
- moves application to `changes_requested`;
- increments Partner version once;
- appends history/audit/outbox atomically.

Resubmission preserves all previous review findings/history. Replaced evidence/payout material resets its verification item to `pending` before resubmission.

### 9.5 Approval

Approval requires, under lock:

- application is `submitted`;
- `expectedVersion` matches;
- all required verification kinds are present and `verified`;
- active payout account exists;
- required evidence is in a safe/reviewable scan state;
- no blocking unresolved review condition remains;
- current actor has tenant approval authority and same-tenant resource access.

One transaction atomically performs:

```text
application_status: submitted → approved
operational_status: inactive → active
Partner.version += 1
PartnerStatusHistory insert(s)
security/business audit insert
outbox insert
```

### 9.6 Rejection

Rejection:

- requires `submitted`;
- requires expected version and authorized tenant reviewer;
- moves application to `rejected`;
- leaves operational state `inactive`;
- preserves memberships, evidence, payout records, findings, audit, and history.

### 9.7 Suspend/reactivate/cancel

- suspend: `active → suspended`;
- reactivate: `suspended → active`, only while application remains approved;
- cancel: `active|suspended → cancelled`;
- cancel is terminal.

Suspend, reactivate, and cancel increment `Partner.authorization_version` because they change Partner-scope authority/eligibility for every member.

An erroneous approval is corrected operationally by suspension and an audited follow-up; the historical `approved` onboarding decision is not silently rewritten.

## 10. Permission catalog and grant policy

Permission keys remain code-owned, lower-case, dot-separated, and append-only.

### 10.1 Partner-scope permissions

Initial Partner permissions:

```text
partner.profile.read
partner.profile.update
partner.application.read
partner.application.submit
partner.verification.read
partner.verification.evidence.read
partner.verification.evidence.upload
partner.payout_account.read
partner.payout_account.update
partner.review_finding.read
```

Initial system-role mapping:

| Permission | `partner_owner` | `partner_admin` |
|---|---:|---:|
| `partner.profile.read` | yes | yes |
| `partner.profile.update` | yes | yes |
| `partner.application.read` | yes | yes |
| `partner.application.submit` | yes | yes |
| `partner.verification.read` | yes | yes |
| `partner.verification.evidence.read` | yes | yes |
| `partner.verification.evidence.upload` | yes | yes |
| `partner.payout_account.read` | yes | yes, masked only |
| `partner.payout_account.update` | yes | no |
| `partner.review_finding.read` | yes | yes |

Partner permissions never authorize changing tenant reviewer verification decisions.

All payout-account read DTOs are masked; no generic endpoint returns the raw decrypted account number.

### 10.2 Tenant review permissions

Initial tenant permissions:

```text
tenant.partner.read
tenant.partner.verification.read
tenant.partner.verification.evidence.read
tenant.partner.verification.review
tenant.partner.payout_account.read
tenant.partner.application.review
tenant.partner.application.approve
tenant.partner.application.reject
tenant.partner.lifecycle.suspend
tenant.partner.lifecycle.reactivate
tenant.partner.lifecycle.cancel
```

System-role defaults:

| Permission | `tenant_admin` | `tenant_owner` |
|---|---:|---:|
| `tenant.partner.read` | yes | yes |
| `tenant.partner.verification.read` | yes | yes |
| `tenant.partner.verification.evidence.read` | yes | yes |
| `tenant.partner.verification.review` | yes | yes |
| `tenant.partner.payout_account.read` | yes, masked | yes, masked |
| `tenant.partner.application.review` | yes | yes |
| `tenant.partner.application.approve` | yes | yes |
| `tenant.partner.application.reject` | yes | yes |
| `tenant.partner.lifecycle.suspend` | no | yes |
| `tenant.partner.lifecycle.reactivate` | no | yes |
| `tenant.partner.lifecycle.cancel` | no | yes |

### 10.3 Tenant dynamic-RBAC delegability

The following may be tenant-delegable through the Sprint 2 custom-role machinery:

```text
tenant.partner.read
tenant.partner.verification.read
tenant.partner.verification.evidence.read
tenant.partner.verification.review
tenant.partner.payout_account.read
tenant.partner.application.review
tenant.partner.application.approve
tenant.partner.application.reject
```

The following remain owner-governed and non-delegable in Sprint 3:

```text
tenant.partner.lifecycle.suspend
tenant.partner.lifecycle.reactivate
tenant.partner.lifecycle.cancel
```

Permission alone never bypasses same-tenant resource policy or lifecycle/state validation.

## 11. Persistence, RLS, and structural invariants

### 11.1 Tenant-owned tables

Tenant-owned Sprint 3 tables include:

```text
partner_registrations
partners
partner_profiles
partner_memberships
partner_role_assignments
partner_verification_items
partner_review_findings
partner_evidence
partner_payout_accounts
partner_status_history
```

Every table carries `tenant_id` and is added to the tenant-policy manifest where normal `booking_app` access is expected.

### 11.2 FORCE RLS

Every Partner-owned tenant table uses:

```sql
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
ALTER TABLE ... FORCE ROW LEVEL SECURITY;
```

Canonical normal-application policy:

```sql
USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
)
```

Missing `app.tenant_id` fails closed.

Sprint 3 does not add `app.partner_id` to PostgreSQL RLS. Database RLS is the final Tenant A/Tenant B boundary. Partner A/Partner B inside the same tenant is protected by authoritative application/resource policy.

### 11.3 Composite tenant-safe constraints

`partners` exposes stable composite identity:

```text
UNIQUE (id, tenant_id)
```

Partner child tables reference:

```text
(partner_id, tenant_id)
→ partners(id, tenant_id)
```

`PartnerMembership` has:

```text
UNIQUE (id, tenant_id, partner_id)
FK (partner_id, tenant_id)
  → partners(id, tenant_id)
FK user_id
  → users(id)
```

Active membership uniqueness:

```text
UNIQUE (tenant_id, partner_id, user_id)
WHERE revoked_at IS NULL
```

`PartnerRoleAssignment` has composite membership binding:

```text
FK (partner_membership_id, tenant_id, partner_id)
→ partner_memberships(id, tenant_id, partner_id)
```

No child record may be retargeted across Tenant or Partner identity through UPDATE.

### 11.4 Stable/append-only database guards

Normal `booking_app` direct DML must be structurally unable to:

- rewrite `partners.id` or `partners.tenant_id`;
- rewrite evidence object identity (`tenant_id`, `partner_id`, `object_key`, checksum, uploader) after insert;
- update/delete append-only PartnerStatusHistory;
- rewrite immutable reviewer-authored finding fields;
- insert a Partner-scope role into generic `role_assignments`;
- insert a Platform/Tenant role into `partner_role_assignments`.

PartnerMembership and PartnerRoleAssignment are append-only under normal Sprint 3 DML: the application role does not receive UPDATE/DELETE on those tables. Future Partner member-management work must introduce explicit lifecycle use cases and monotonic revocation guards before widening DML.

Database triggers/constraints protect structural impossibilities. Application transitions, permission checks, verification completeness, audit orchestration, and business state machines remain use-case responsibilities.

### 11.5 Minimum DML

Proposed normal application privileges:

| Table | `booking_app` |
|---|---|
| `partner_registrations` | `SELECT, INSERT, UPDATE` |
| `partners` | `SELECT, INSERT, UPDATE` |
| `partner_profiles` | `SELECT, INSERT, UPDATE` |
| `partner_memberships` | `SELECT, INSERT` |
| `partner_role_assignments` | `SELECT, INSERT` |
| `partner_verification_items` | `SELECT, INSERT, UPDATE` |
| `partner_review_findings` | `SELECT, INSERT, UPDATE` |
| `partner_evidence` | `SELECT, INSERT, UPDATE` |
| `partner_payout_accounts` | `SELECT, INSERT, UPDATE` |
| `partner_status_history` | `SELECT, INSERT` |

No normal Sprint 3 business/history table requires `DELETE`.

The tenant-policy verifier must reject missing and excessive privileges.

## 12. Evidence storage security

Partner verification evidence lives in a private bucket/storage namespace separate from public listing media.

Server-generated object shape:

```text
partner-evidence/<opaque-tenant-id>/<opaque-partner-id>/<random-object-id>
```

The object key never includes raw email, company name, bank account, original user filename, or another PII-derived path segment.

Upload flow:

```text
authorized Partner request
→ create upload intent
→ server-generated object id/key
→ short-lived upload capability
→ client upload
→ finalize
→ server verifies expected metadata/checksum
→ persist PartnerEvidence
→ malware-scan adapter
→ clean or quarantined
```

Download flow:

```text
authorized Partner/tenant reviewer request
→ authoritative resource policy
→ clean evidence state
→ short-lived signed GET or controlled server stream
```

Evidence is never exposed through a permanent public URL.

Initial restrictions:

- content-type allowlist;
- bounded file size;
- server-generated object key;
- stored checksum;
- original filename sanitized and used only as display metadata;
- executable/public HTML rendering prohibited;
- risky document types forced to attachment disposition;
- reviewer consumption blocked until scan state is `clean`.

Scan status:

```text
pending_scan
clean
quarantined
```

Sprint 3 requires an `EvidenceScannerPort` and an implementation usable in local/CI plus a production-safe configured adapter. Provider choice belongs to the implementation plan; no adapter may mark content `clean` without performing the configured scan/validation contract.

## 13. Payout-account security

Payout account values are not stored in generic JSON, audit metadata, or plaintext columns.

Application-facing crypto port encrypts the full account number before persistence. Persistence keeps:

- ciphertext;
- last four digits for masking;
- keyed fingerprint for equality/duplicate detection where required;
- key version for rotation/migration.

Default read DTO composes canonical verification state from `PartnerVerificationItem(kind = payout_account)`:

```text
bankCode
accountHolderName
accountNumberMasked = ******1234
verificationStatus
version
```

No Sprint 3 endpoint returns the full decrypted account number.

Replacement uses append/supersede:

```text
old account → superseded_at = now
new account → INSERT
payout_account verification item → pending
```

Those changes occur in one Partner transaction while the application is editable.

One active-current payout row is enforced with a partial unique index on `(tenant_id, partner_id) WHERE superseded_at IS NULL`.

## 14. Application use cases

### 14.1 Public registration

- `StartPartnerRegistration`
- `VerifyPartnerRegistrationEmail`
- `CompletePartnerRegistration`

New-user identity setup is performed through an exported Identity application contract and the normal shared credential policy; existing users authenticate through the existing login flow.

### 14.2 Partner self-service

- `GetPartnerSelf`
- `GetPartnerApplication`
- `UpdatePartnerProfile`
- `GetPartnerVerification`
- `ListPartnerEvidence`
- `CreatePartnerEvidenceUploadIntent`
- `FinalizePartnerEvidence`
- `SetPartnerPayoutAccount`
- `GetPartnerReviewFindings`
- `SubmitPartnerApplication`

`/partner/me/*` use cases derive Partner identity from the authoritative Partner session. They do not accept `tenantId` or `partnerId` as trust context.

Partner use cases never directly set verification status to `verified`, `changes_required`, or `rejected`.

### 14.3 Tenant operations

- `ListPartners`
- `GetPartnerForReview`
- `GetPartnerEvidenceForReview`
- `VerifyPartnerVerificationItem`
- `MarkPartnerVerificationChangesRequired`
- `RejectPartnerVerificationItem`
- `RequestPartnerChanges`
- `ApprovePartner`
- `RejectPartner`
- `SuspendPartner`
- `ReactivatePartner`
- `CancelPartner`

Tenant operations receive `partnerId` as a resource identifier but always load it under authoritative tenant context and enforce `partner.tenant_id === current tenant` with fail-closed semantics.

## 15. Transaction and locking strategy

No universal Prisma transaction client escapes infrastructure.

Conceptual application port:

```text
PartnerTransactionPort.run(tenantContext, work)
```

A transaction adapter:

1. opens PostgreSQL transaction;
2. sets `SET LOCAL ROLE booking_app`;
3. sets transaction-local `app.tenant_id`;
4. constructs only the repositories/capabilities required by Partner use cases;
5. executes the application callback;
6. commits or rolls back atomically.

### 15.1 Canonical lock order

Use cases that require multiple rows acquire locks in this order:

```text
registration prerequisite where required
→ Partner
→ PartnerMembership
→ PartnerRoleAssignment
→ PartnerProfile
→ PartnerVerificationItem (stable kind/id order)
→ PartnerPayoutAccount
→ PartnerEvidence (stable id order)
→ PartnerReviewFinding
→ append-only history/audit/outbox writes
```

No mutation uses the reverse order.

### 15.2 Edit versus submit

Profile, payout, evidence-finalize, and other review-material mutations lock the Partner root before child mutation. Submit locks Partner first and validates all required child state under the same transaction. This serializes edit-vs-submit races and makes a submitted version coherent.

### 15.3 Verification decision

Tenant verification decisions lock Partner first, require `submitted`, then lock the target verification item. They use target-item `expectedVersion` so two reviewers cannot silently overwrite one another.

### 15.4 Submit

`SubmitPartnerApplication(expectedVersion)`:

```text
lock Partner
→ validate expectedVersion
→ require draft | changes_requested
→ load/validate required profile/payout/evidence/declarations
→ set application_status = submitted
→ Partner.version += 1
→ append history/audit/outbox
```

### 15.5 Request changes

```text
lock Partner
→ expectedVersion
→ require submitted
→ validate tenant review authority
→ require actionable finding or changes_required verification item
→ application_status = changes_requested
→ Partner.version += 1
→ history/audit/outbox
```

### 15.6 Approve

```text
lock Partner
→ expectedVersion
→ require submitted
→ lock/read required verification items
→ lock/read active payout account
→ validate evidence clean/reviewable
→ validate no blocking review condition
→ application_status = approved
→ operational_status = active
→ Partner.version += 1
→ history/audit/outbox
```

### 15.7 Reject

```text
lock Partner
→ expectedVersion
→ require submitted
→ validate tenant reject authority
→ application_status = rejected
→ Partner.version += 1
→ history/audit/outbox
```

### 15.8 Suspend/reactivate/cancel

Each command locks Partner, validates current state and expected version, applies the transition, advances Partner version, advances `Partner.authorization_version`, and appends required history/audit/outbox in the same transaction.

## 16. Authorization-version invalidation

Partner sessions snapshot:

```text
User.authorization_version
Partner.authorization_version
PartnerMembership.authorization_version
```

Sprint 3 authority-changing examples:

- Partner operational `active → suspended`;
- Partner operational `suspended → active`;
- Partner operational `active|suspended → cancelled`.

Partner-wide authority change increments `Partner.authorization_version` once, invalidating all Partner sessions without mass-updating membership rows.

`PartnerMembership.authorization_version` is part of the scope foundation for later member-management mutations but remains stable for the initiating owner in Sprint 3 because member suspend/revoke/grant use cases are deferred.

Protected requests reconcile versions and current state before executing Partner product logic.

## 17. HTTP and browser boundary

### 17.1 Partner self-service API

Conceptual routes:

```text
GET    /partner/me
GET    /partner/me/application
PATCH  /partner/me/profile
GET    /partner/me/verification
GET    /partner/me/evidence
GET    /partner/me/payout-account
PUT    /partner/me/payout-account
GET    /partner/me/review-findings
POST   /partner/me/application/submit
POST   /partner/me/evidence/upload-intents
POST   /partner/me/evidence/:evidenceId/finalize
```

### 17.2 Tenant review API

```text
GET  /tenant/partners
GET  /tenant/partners/:partnerId
GET  /tenant/partners/:partnerId/evidence/:evidenceId
POST /tenant/partners/:partnerId/verifications/:kind/verify
POST /tenant/partners/:partnerId/verifications/:kind/changes-required
POST /tenant/partners/:partnerId/verifications/:kind/reject
POST /tenant/partners/:partnerId/request-changes
POST /tenant/partners/:partnerId/approve
POST /tenant/partners/:partnerId/reject
POST /tenant/partners/:partnerId/suspend
POST /tenant/partners/:partnerId/reactivate
POST /tenant/partners/:partnerId/cancel
```

Evidence content is returned only through the authorized storage/download boundary, not embedded as normal JSON.

State transitions use explicit command endpoints. Clients cannot PATCH arbitrary `applicationStatus`, `operationalStatus`, or verification status fields.

### 17.3 Mutation contract

Sensitive transitions include `expectedVersion` and bounded reason data where applicable. Verification decisions include verification-item `expectedVersion`.

Version mismatch returns a stable 409 conflict. Clients refetch; the API does not silently retry stale business intent.

### 17.4 Safe errors

Canonical error family includes:

```text
PARTNER_NOT_FOUND
PARTNER_APPLICATION_INVALID_STATE
PARTNER_APPLICATION_INCOMPLETE
PARTNER_VERSION_CONFLICT
PARTNER_VERIFICATION_VERSION_CONFLICT
PARTNER_VERIFICATION_INCOMPLETE
PARTNER_MEMBERSHIP_INACTIVE
PARTNER_OPERATION_FORBIDDEN
PARTNER_REGISTRATION_TOKEN_INVALID
PARTNER_REGISTRATION_TOKEN_EXPIRED
PARTNER_REGISTRATION_TOKEN_CONSUMED
PARTNER_REGISTRATION_CONTINUATION_INVALID
PARTNER_REGISTRATION_CONTINUATION_EXPIRED
PARTNER_REGISTRATION_CONTINUATION_CONSUMED
PARTNER_EVIDENCE_NOT_SAFE
```

Foreign/inaccessible Partner identifiers use fail-closed not-found/denied semantics without revealing existence in another tenant or inaccessible Partner scope.

### 17.5 CSRF / Origin / caching

Unsafe cookie-authenticated requests continue to require:

```text
approved exact Origin
+ valid session-bound CSRF proof
+ valid host-bound opaque session
```

The short-lived Partner-registration continuation cookie is purpose-limited and does not authorize normal Partner APIs. Existing active Users must still authenticate normally before completion.

Sensitive Partner/current-authorization responses use private/no-store semantics. Browser JavaScript never reads session or registration-continuation cookies.

## 18. Concurrency and idempotency

Required real PostgreSQL concurrency evidence:

```text
S3-CON01  profile edit vs submit
S3-CON02  payout-account replace vs submit
S3-CON03  evidence finalize vs submit
S3-CON04  concurrent verification decisions on the same verification item
S3-CON05  approve vs request-changes
S3-CON06  approve vs reject
S3-CON07  two concurrent approvals
S3-CON08  stale reviewer expectedVersion vs newer resubmission
S3-CON09  suspend vs cancel
S3-CON10  reactivate vs cancel
S3-CON11  registration email-token double exchange
S3-CON12  same registration continuation consumed concurrently
S3-CON13  duplicate registration completion cannot create duplicate Partner establishment
S3-CON14  suspended/cancelled Partner stale session cannot execute protected Partner use case
```

Registration completion is naturally idempotent through consumed continuation/registration identity and transaction constraints.

Lifecycle/review commands use current-state validation + `expectedVersion`. A repeated stale command must not create a second history/audit/outbox event.

Invariant:

```text
one real state transition
→ one version advance
→ one required history effect
→ one required audit effect
→ one required outbox effect
```

## 19. Database acceptance requirements

Required structural/RLS acceptance:

```text
S3-DB01 Tenant A cannot SELECT Partner of Tenant B under booking_app.
S3-DB02 Tenant A cannot INSERT a child row referencing Tenant B Partner.
S3-DB03 PartnerMembership cannot reference/retarget another tenant or Partner identity.
S3-DB04 PartnerRoleAssignment cannot reference/retarget another tenant/Partner/membership identity.
S3-DB05 Partner stable id/tenant_id cannot be rewritten through direct UPDATE.
S3-DB06 booking_app cannot UPDATE/DELETE PartnerMembership or PartnerRoleAssignment in Sprint 3.
S3-DB07 Evidence object identity/checksum/uploader cannot be rewritten.
S3-DB08 PartnerStatusHistory cannot be UPDATE/DELETE by booking_app.
S3-DB09 booking_app has exact required minimum DML and no excess DML.
S3-DB10 Missing app.tenant_id fails closed.
S3-DB11 FORCE RLS remains enabled and forced for every Partner-owned table.
S3-DB12 Generic role_assignments rejects Partner-scope roles; partner_role_assignments accepts only approved Partner-scope system roles.
```

Same-tenant Partner A/Partner B authorization is proved at application/API acceptance because tenant RLS intentionally does not provide nested Partner isolation.

## 20. Acceptance matrix

Primary Sprint 3 acceptance IDs:

| ID | Acceptance |
|---|---|
| `S3-PARTNER01` | Registration start is enumeration-safe and does not disclose account/Partner existence. |
| `S3-PARTNER02` | Email verification token is single-use, purpose/host/tenant-bound, hashed at rest, and rotates to a separate short-lived HttpOnly continuation. |
| `S3-PARTNER03` | Registration completion atomically consumes continuation and establishes Partner + active initial PartnerMembership + `partner_owner`; concurrent retry does not duplicate establishment. |
| `S3-PARTNER04` | Existing global User is reused; new registration does not create a parallel credential/account system. |
| `S3-PARTNER05` | Partner session is exact-host/current-scope bound and reconciles User + Partner + PartnerMembership authorization versions. |
| `S3-PARTNER06` | Draft/changes-requested may edit; submitted Partner-owned review material is frozen while tenant verification decisions remain allowed. |
| `S3-PARTNER07` | Submit requires complete type-specific profile, payout, evidence, and declarations. |
| `S3-PARTNER08` | Partner cannot self-verify; only tenant verification-review authority can change verification decisions, with optimistic versioning and audit. |
| `S3-PARTNER09` | Request-changes creates/preserves immutable findings and reopens Partner editing without rewriting review history. |
| `S3-PARTNER10` | Approve validates all required verification/evidence under lock and atomically makes the Partner approved + active. |
| `S3-PARTNER11` | Reject is state-safe and preserves history/evidence/membership records. |
| `S3-PARTNER12` | Draft/submitted/changes-requested Partner with operational `inactive` may authenticate for onboarding but cannot pass future operational inventory policy. |
| `S3-PARTNER13` | Suspend/reactivate/cancel follow the state machine; cancel is terminal; Partner authorization-version invalidates stale sessions. |
| `S3-PARTNER14` | Partner A cannot read/write Partner B resources inside the same tenant through Partner self-service/resource policy. |
| `S3-PARTNER15` | Tenant A cannot read/write Tenant B Partner data through API or booking_app; missing tenant context fails closed. |
| `S3-PARTNER16` | Composite FK/stable-identity/minimum-DML guards prevent cross-tenant/cross-Partner retargeting or unauthorized membership/role mutation. |
| `S3-PARTNER17` | Evidence storage is private, server-keyed, malware-scan-gated, append/supersede, and unauthorized access fails closed. |
| `S3-PARTNER18` | Payout account is encrypted at rest, masked in DTOs, uses verification item as the single status source, and replacement preserves history. |
| `S3-PARTNER19` | Required registration/verification/review/lifecycle/stale-authority races converge deterministically on PostgreSQL. |
| `S3-PARTNER20` | Partner scope never unions Tenant permissions; explicit scope switch rotates session authority. |
| `S3-PARTNER21` | Existing active User registration requires normal account authentication before Partner establishment; email verification/continuation is not a password bypass. |

Primary command:

```bash
pnpm verify:partner-onboarding
```

## 21. Protected CI and regression gates

`verify:partner-onboarding` aggregates at minimum:

- Partner domain/application unit tests;
- registration/identity/session security tests;
- Partner API integration/E2E tests;
- PostgreSQL/RLS tests;
- database structural and minimum-DML tests;
- concurrency tests;
- permission-catalog/grant-policy verification;
- evidence/payout secret-leak regressions.

Protected PR verification remains blocking for:

```text
format/static rules
lint
typecheck
architecture boundaries
Prisma schema validation
migrations
migration verification
OpenAPI compatibility/generated client
unit tests
API E2E + RLS
Sprint 1B identity-access acceptance
Sprint 2 dynamic-RBAC acceptance
Sprint 3 Partner acceptance
build
browser/Playwright security smoke
production configuration guard
dependency audit
committed-secret scan
knowledge validation
delivery-reconciliation validation
```

Sprint 3 cannot be called technically complete unless Sprint 1B + Sprint 2 + Sprint 3 + all protected repository gates are GREEN on the exact final head.

## 22. OpenAPI and generated-client contract

Partner HTTP DTO/controller contracts remain server-authoritative and generated through the current code-first OpenAPI path:

```text
Nest DTO/controller
→ OpenAPI document
→ generated client
→ compatibility gate
```

Frontend code does not maintain a second hand-written Partner API type system.

Negative OpenAPI/E2E contracts include:

- inaccessible Partner;
- stale Partner/verification version;
- invalid lifecycle/application transition;
- incomplete verification;
- invalid/expired/consumed registration email token or continuation;
- inactive PartnerMembership;
- suspended/cancelled Partner;
- wrong host/scope;
- unsafe Origin/missing CSRF.

## 23. Browser security acceptance

Critical browser acceptance proves:

- registration verification fragment is scrubbed before normal navigation/referrer/logging;
- raw registration email token never reaches server access logs or analytics;
- registration continuation is host-only, HttpOnly, purpose-limited, short-lived, and not a normal auth session;
- `__Host-` session-cookie invariants remain intact;
- wrong-host and wrong-scope replay reject;
- Partner scope does not inherit Tenant permissions;
- scope switching rotates session material;
- unsafe normal Partner mutations require Origin + CSRF;
- sensitive Partner pages/API are private/no-store;
- generic diagnostics never render raw payout account, signed evidence URL, tokens, cookies, or CSRF material.

Full visual onboarding polish is not required to close the backend foundation, but the real browser security path for registration and scope establishment is required.

## 24. Audit, metrics, and outbox

### 24.1 Required audit events

```text
partner.registration.completed
partner.application.submitted
partner.application.changes_requested
partner.application.resubmitted
partner.application.approved
partner.application.rejected
partner.verification.changed
partner.evidence.added
partner.evidence.superseded
partner.payout_account.changed
partner.suspended
partner.reactivated
partner.cancelled
```

Initial owner membership/role establishment is represented by `partner.registration.completed` metadata rather than by exposing general Partner member-management audit contracts before those use cases exist.

Audit metadata may contain bounded identifiers/reference IDs, transition type, reason code, request ID, and safe result metadata.

Audit must never contain:

- raw registration/continuation/session token;
- cookie/Authorization/CSRF header;
- evidence binary;
- long-lived/signed object URL;
- full payout account number;
- credential hash/secret;
- email body.

### 24.2 Metrics

Bounded metrics may include:

```text
partner_registration_started_total{result}
partner_registration_completed_total{result}
partner_application_transition_total{transition,result}
partner_verification_transition_total{kind,result}
partner_evidence_finalize_total{result}
partner_payout_account_change_total{result}
partner_authorization_reconciliation_total{result}
```

Metrics must not label with raw `tenant_id`, `partner_id`, `user_id`, email, object key, account number, token, or other high-cardinality/sensitive identity.

### 24.3 Outbox

Business transitions write outbox records in the same database transaction where downstream notification/job delivery is required.

Initial outbox intentions include:

```text
partner.registration.verification_requested
partner.application.submitted
partner.application.changes_requested
partner.application.approved
partner.application.rejected
partner.suspended
partner.reactivated
```

External email/provider delivery occurs after commit through worker delivery/retry. Provider failure does not roll back an already committed Partner business transition.

## 25. Recovery and operational guidance

Sprint 3 closeout creates:

```text
docs/runbooks/partner-onboarding-recovery.md
```

It must cover:

1. registration email not received;
2. registration email token/continuation expired or consumed;
3. new global identity created but Partner establishment failed;
4. suspected duplicate registration;
5. Partner application incorrectly approved;
6. Partner incorrectly suspended/reactivated/cancelled;
7. payout account reported incorrect/compromised;
8. evidence upload corrupted or quarantined;
9. stale Partner session after suspend/cancel;
10. Partner onboarding mutation outage;
11. cross-tenant/RLS incident response;
12. notification/outbox backlog.

Recovery must not recommend deleting history to reset state. Corrections use supported reversal/new workflow where available or a controlled, explicitly owned, audited database operation when product tooling does not yet exist.

For an incorrect approval, the immediate supported containment is Partner suspension; approval history remains append-only until a later re-verification/correction workflow is explicitly designed.

## 26. Knowledge closeout

Implementation closeout must create/update at least:

```text
docs/features/FEATURE-0004-partner-onboarding.md
docs/patterns/PATTERN-0005-partner-scope-authority.md
docs/runbooks/partner-onboarding-recovery.md
docs/plan/90-DAY-EXECUTION.md
genesis/reviews/PILOT-GATES.md
```

Historical sprint-numbering ambiguity is reconciled as metadata/documentation; implementation is not rewritten merely to make old numbering match.

## 27. Explicit Sprint 3 exit criteria

Sprint 3 is complete only when all are true:

1. Partner registration email-link + continuation flow works end-to-end.
2. Existing global identity/shared password/session kernel is reused; no Partner auth stack exists in parallel.
3. Partner is a distinct authorization scope and does not require TenantMembership.
4. Partner scope never unions Tenant permission authority.
5. Partner aggregate supports individual/company onboarding and approved lifecycle transitions.
6. Only tenant verification-review authority can make verification decisions; Partner cannot self-verify.
7. Tenant reviewer request-changes/approve/reject flow works with immutable review history.
8. Approval atomically makes the Partner application approved and operationally active.
9. Partner scope authority includes User + Partner + PartnerMembership versions, required permission, same-Partner resource policy, and lifecycle eligibility.
10. Same-tenant Partner A/B isolation is executable application/API evidence.
11. Cross-tenant Partner persistence is executable FORCE-RLS/composite-FK evidence.
12. Evidence is private, scan-gated, and append/supersede.
13. Payout account is encrypted/masked, uses one canonical verification status source, and raw values are absent from generic logs/audit/API DTOs.
14. Required concurrency and stale-authority cases pass against PostgreSQL.
15. Audit/history/outbox transaction semantics are executable evidence.
16. OpenAPI/generated-client and critical browser security gates pass.
17. Sprint 1B and Sprint 2 acceptance remain GREEN.
18. All protected repository gates are GREEN on exact final head.
19. Partner recovery/feature/pattern/roadmap closeout artifacts are complete.

Sprint 3 exit explicitly does **not** require listing, resource, availability, pricing, publication, booking, payment, finance, or payout execution.

## 28. Recommended implementation decomposition

The design is one coherent subsystem and can be executed through one detailed implementation plan, but the plan should preserve small TDD slices. Recommended task order:

1. Partner scope enums, Permission Catalog V2 additions, system-role/grant-policy contracts, and generic/Partner role-assignment separation.
2. Partner persistence schema, PartnerRegistration token/continuation model, composite constraints, FORCE RLS, minimum DML, and structural guards.
3. Partner domain model, ports, repositories, transaction session, and in-memory/unit contracts.
4. Registration email-token exchange, continuation cookie, and Identity application bridge for existing/new users.
5. Partner-scoped session/authorization-context extension, explicit scope switching, and stale-authority reconciliation.
6. Partner self-service profile/payout/evidence/application use cases plus evidence scanner/storage adapters.
7. Tenant verification decisions, review/request-changes/approve/reject use cases, and optimistic/concurrency behavior.
8. Suspend/reactivate/cancel and Partner-wide authorization invalidation.
9. HTTP/OpenAPI/generated-client/browser security integration.
10. `S3-PARTNER01`–`S3-PARTNER21`, DB/concurrency acceptance command, protected CI integration.
11. Knowledge, runbook, reconciliation, and final verification closeout.

Production implementation must follow TDD: each task establishes a failing contract/evidence first, then the smallest production change that makes it pass, followed by protected verification before completion claims.

## 29. Design decisions intentionally deferred

The following decisions are not unresolved requirements for Sprint 3; they are intentionally deferred because their owning flows do not exist yet:

- Partner custom-role CRUD and Partner Role Builder UI;
- Partner member invitation/suspend/revoke/team-management product flow;
- detailed post-approval business-information amendment/re-verification workflow;
- how Partner suspension/cancellation interacts with future confirmed bookings;
- listing/media publication permissions;
- Partner booking/finance permissions;
- payout execution access to full decrypted bank account values;
- Customer/Partner multi-actor UX switching beyond the minimum secure current-scope rotation contract;
- partner-level PostgreSQL nested RLS.

When those flows are scheduled, they must extend the current boundaries rather than bypass them.

## 30. Final design invariant

The Sprint 3 authorization boundary is:

```text
trusted active tenant hostname
+ authenticated global User
+ current Partner scope
+ active same-tenant Partner
+ active same-Partner PartnerMembership
+ current User/Partner/PartnerMembership authorization versions
+ code-seeded Partner permission
+ authoritative same-Partner resource policy
+ Partner lifecycle eligibility
+ PostgreSQL FORCE RLS for tenant-owned persistence
```

A Partner can authenticate and complete onboarding before operational approval, but authentication is never equivalent to inventory authority.
