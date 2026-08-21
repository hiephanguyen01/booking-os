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
→ tenant review / changes requested
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
6. let a Partner edit a draft/changes-requested application, submit it, and inspect review findings;
7. let authorized tenant operators review, request changes, approve, or reject the application;
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
- automatic KYC/eKYC, mandatory video verification, or mandatory physical site visits;
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
- Partner persistence adapters may consume exported Identity/Sessions/Authorization application contracts but never their infrastructure directories or tables directly from application/domain code.
- Another module may consume Partner behavior only through explicit application-facing contracts.
- Existing foundation code is touched only where the Partner scope genuinely extends the shared kernel.

### 5.1 Module ownership

`IdentityModule` continues to own:

- global User identity;
- normalized email identity;
- password credentials;
- password reset and account activation security primitives;
- secure token/hash primitives used through exported application ports.

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
- PartnerMembership and PartnerRoleAssignment persistence;
- Partner application/profile;
- Partner verification records;
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

Required scope-shape constraint:

```text
platform: tenant_id IS NULL  AND partner_id IS NULL
tenant:   tenant_id IS NOT NULL AND partner_id IS NULL
partner:  tenant_id IS NOT NULL AND partner_id IS NOT NULL
```

`AuthSessionToken` carries/validates matching scope and tenant/partner shape where the existing duplicated scope fields are retained. Wrong-host, wrong-tenant, wrong-partner, wrong-scope, stale-version, suspended Partner, inactive PartnerMembership, or inactive User fail before product use-case execution.

## 7. Partner registration and identity establishment

### 7.1 Public registration contract

The public start endpoint is enumeration-safe:

```text
POST /partner-registration/start
```

Input contains the normalized registration email plus the minimal request data required to send a verification link. The public response never reveals whether the email already belongs to a global User, existing Partner, pending registration, or ineligible account.

Canonical response intent:

```text
If the address can be used for Partner registration,
verification instructions will be sent.
```

### 7.2 Registration challenge

Partner registration uses a dedicated purpose-bound challenge while reusing the shared secure-token/hash/delivery infrastructure through application ports.

Conceptual record:

```text
PartnerRegistrationChallenge
├── id
├── tenant_id
├── normalized_email
├── hostname
├── selector
├── token_hash
├── expires_at
├── consumed_at
├── revoked_at
├── created_at
└── request_fingerprint / abuse metadata where approved
```

The challenge is:

- single-use;
- short-lived;
- hostname-bound;
- tenant-bound;
- purpose-bound to Partner registration;
- selector + keyed digest/hash at rest;
- raw secret excluded from logs, audit, metrics, and persistence.

Starting a registration does not have to create a global User row for an unverified email. New global identity creation is deferred until verified registration completion, preventing unauthenticated requests from filling the global User table with arbitrary third-party emails.

### 7.3 Verification link

Email links place the raw one-time secret in a browser fragment where feasible:

```text
https://<tenant-host>/partner/register/verify#<secret>
```

The browser/BFF scrubs the fragment before the secret can reach normal navigation, referrer, analytics, or server access logs, then performs the same-origin exchange.

### 7.4 Existing-user and new-user branches

Email ownership and account authentication are distinct.

**Existing active User:**

- verification proves control of the registration email;
- the email link alone does not silently mint a full session for an already-active existing account;
- the actor authenticates using the existing credential/session flow before Partner establishment is committed;
- password-reset uses the existing shared recovery flow when needed;
- registration completion verifies the authenticated User matches the verified normalized email.

**New User:**

- successful email verification authorizes the new-account continuation;
- the shared identity flow establishes the global User and password credential/activation state;
- Partner establishment is committed only after the new identity is valid for authentication;
- final Partner session issuance occurs after the establishment transaction commits.

This preserves one global identity and avoids using Partner registration as a password bypass for an existing account.

### 7.5 Atomic Partner establishment

The establishment transaction creates:

```text
Partner
+ active initial PartnerMembership
+ partner_owner PartnerRoleAssignment
+ initial Partner/application history
+ required audit event
+ required outbox event
+ consumed registration establishment marker
```

The transaction is idempotent under concurrent verification/completion. It cannot leave:

- a Partner with no initial owner membership;
- an owner membership pointing at a different tenant/Partner;
- duplicate Partners for the same establishment request;
- a consumed registration establishment that never committed its Partner state.

Session issue/rotation happens only after the establishment transaction commits.

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
- `submitted` freezes review material against Partner self-service mutation.
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

Approval requires every type-required verification item to be `verified`.

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
├── verification_status
├── version
├── created_at
└── superseded_at
```

Only one non-superseded payout account exists per Partner. Replacement creates a new record and supersedes the old one.

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

Status:

```text
active
suspended
revoked
```

Initial registration creates one active owner membership. Active PartnerMembership means the user may enter the Partner scope; it does not imply the Partner is operationally active.

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

Sprint 3 creates only the initiating `partner_owner` assignment through the public product flow. `partner_admin` is seeded as the Partner system-role foundation but no Sprint 3 team-management endpoint grants additional memberships.

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

## 9. Submission and review rules

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

Once submitted, Partner self-service cannot alter review-relevant profile, payout, verification, or evidence data until the tenant requests changes. This makes a submission version reviewable as a coherent snapshot.

### 9.3 Request changes

`RequestPartnerChanges`:

- requires current `submitted` state;
- inserts immutable findings;
- moves application to `changes_requested`;
- increments Partner version once;
- appends history/audit/outbox atomically.

Resubmission preserves all previous review findings/history.

### 9.4 Approval

Approval requires, under lock:

- application is `submitted`;
- `expectedVersion` matches;
- all required verification kinds are present and `verified`;
- active payout account exists and its verification requirement is satisfied;
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

### 9.5 Rejection

Rejection:

- requires `submitted`;
- requires expected version and authorized tenant reviewer;
- moves application to `rejected`;
- leaves operational state `inactive`;
- preserves memberships, evidence, payout records, findings, audit, and history.

### 9.6 Suspend/reactivate/cancel

- suspend: `active → suspended`;
- reactivate: `suspended → active`, only while application remains approved;
- cancel: `active|suspended → cancelled`;
- cancel is terminal.

Suspend, reactivate, and cancel increment `Partner.authorization_version` because they change Partner-scope authority/eligibility for every member.

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
partner.verification.update
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
| `partner.verification.update` | yes | yes |
| `partner.payout_account.read` | yes | yes, masked only |
| `partner.payout_account.update` | yes | no |
| `partner.review_finding.read` | yes | yes |

All payout-account read DTOs are masked; no generic endpoint returns the raw decrypted account number.

### 10.2 Tenant review permissions

Initial tenant permissions:

```text
tenant.partner.read
tenant.partner.verification.read
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
partner_registration_challenges
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

### 11.4 Stable/monotonic database guards

Normal `booking_app` direct DML must be structurally unable to:

- rewrite `partners.id` or `partners.tenant_id`;
- rewrite PartnerMembership `(tenant_id, partner_id, user_id)` identity;
- rewrite PartnerRoleAssignment `(tenant_id, partner_id, partner_membership_id, role_id)` identity;
- change revoked PartnerMembership/PartnerRoleAssignment back to active by clearing `revoked_at`;
- rewrite evidence object identity (`tenant_id`, `partner_id`, `object_key`, checksum, uploader) after insert;
- update/delete append-only PartnerStatusHistory;
- rewrite immutable reviewer-authored finding fields.

Database triggers/constraints protect only structural impossibilities. Application transitions, permission checks, verification completeness, audit orchestration, and business state machines remain use-case responsibilities.

### 11.5 Minimum DML

Proposed normal application privileges:

| Table | `booking_app` |
|---|---|
| `partner_registration_challenges` | `SELECT, INSERT, UPDATE` |
| `partners` | `SELECT, INSERT, UPDATE` |
| `partner_profiles` | `SELECT, INSERT, UPDATE` |
| `partner_memberships` | `SELECT, INSERT, UPDATE` |
| `partner_role_assignments` | `SELECT, INSERT, UPDATE` |
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
→ scan/quarantine state
```

Download flow:

```text
authorized Partner/tenant reviewer request
→ authoritative resource policy
→ safe/reviewable evidence state
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
- reviewer consumption blocked until scan state is safe.

Scan status:

```text
pending_scan
clean
quarantined
```

If an external malware scanner adapter is not available in the first implementation task, the system must fail closed: an unscanned object cannot satisfy approval eligibility.

## 13. Payout-account security

Payout account values are not stored in generic JSON, audit metadata, or plaintext columns.

Application-facing crypto port encrypts the full account number before persistence. Persistence keeps:

- ciphertext;
- last four digits for masking;
- keyed fingerprint for equality/duplicate detection where required;
- key version for rotation/migration.

Default read DTO:

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
```

One active-current record is enforced with a partial unique index on `(tenant_id, partner_id) WHERE superseded_at IS NULL`.

## 14. Application use cases

### 14.1 Public registration

- `StartPartnerRegistration`
- `VerifyPartnerRegistrationEmail`
- `CompletePartnerRegistration`

### 14.2 Partner self-service

- `GetPartnerSelf`
- `GetPartnerApplication`
- `UpdatePartnerProfile`
- `CreatePartnerEvidenceUploadIntent`
- `FinalizePartnerEvidence`
- `SetPartnerPayoutAccount`
- `GetPartnerVerification`
- `GetPartnerReviewFindings`
- `SubmitPartnerApplication`

`/partner/me/*` use cases derive Partner identity from the authoritative Partner session. They do not accept `tenantId` or `partnerId` as trust context.

### 14.3 Tenant operations

- `ListPartners`
- `GetPartnerForReview`
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
identity/registration prerequisite where required
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

### 15.3 Submit

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

### 15.4 Request changes

```text
lock Partner
→ expectedVersion
→ require submitted
→ validate tenant review authority
→ insert immutable findings
→ application_status = changes_requested
→ Partner.version += 1
→ history/audit/outbox
```

### 15.5 Approve

```text
lock Partner
→ expectedVersion
→ require submitted
→ lock/read required verification items
→ lock/read active payout account
→ validate evidence safe/reviewable
→ validate no blocking review condition
→ application_status = approved
→ operational_status = active
→ Partner.version += 1
→ history/audit/outbox
```

### 15.6 Reject

```text
lock Partner
→ expectedVersion
→ require submitted
→ validate tenant reject authority
→ application_status = rejected
→ Partner.version += 1
→ history/audit/outbox
```

### 15.7 Suspend/reactivate/cancel

Each command locks Partner, validates current state and expected version, applies the transition, advances Partner version, advances `Partner.authorization_version`, and appends required history/audit/outbox in the same transaction.

## 16. Authorization-version invalidation

Partner sessions snapshot:

```text
User.authorization_version
Partner.authorization_version
PartnerMembership.authorization_version
```

Authority-changing examples:

- Partner operational `active → suspended`;
- Partner operational `active|suspended → cancelled`;
- PartnerMembership suspend/revoke/reactivate-via-new-record semantics;
- PartnerRoleAssignment grant/revoke;
- future Partner custom-role authority mutations.

Partner-wide authority change increments `Partner.authorization_version` once, invalidating all Partner sessions without mass-updating every membership row.

Membership-specific authority change increments `PartnerMembership.authorization_version` for that member.

Protected requests reconcile versions and current state before executing Partner product logic.

## 17. HTTP and browser boundary

### 17.1 Partner self-service API

Conceptual routes:

```text
GET    /partner/me
GET    /partner/me/application
PATCH  /partner/me/profile
GET    /partner/me/verification
PUT    /partner/me/verification/:kind
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
POST /tenant/partners/:partnerId/request-changes
POST /tenant/partners/:partnerId/approve
POST /tenant/partners/:partnerId/reject
POST /tenant/partners/:partnerId/suspend
POST /tenant/partners/:partnerId/reactivate
POST /tenant/partners/:partnerId/cancel
```

State transitions use explicit command endpoints. Clients cannot PATCH arbitrary `applicationStatus` or `operationalStatus` fields.

### 17.3 Mutation contract

Sensitive transitions include `expectedVersion` and bounded reason data where applicable.

Version mismatch returns a stable 409 conflict. Clients refetch; the API does not silently retry stale business intent.

### 17.4 Safe errors

Canonical error family includes:

```text
PARTNER_NOT_FOUND
PARTNER_APPLICATION_INVALID_STATE
PARTNER_APPLICATION_INCOMPLETE
PARTNER_VERSION_CONFLICT
PARTNER_VERIFICATION_INCOMPLETE
PARTNER_MEMBERSHIP_INACTIVE
PARTNER_OPERATION_FORBIDDEN
PARTNER_REGISTRATION_TOKEN_INVALID
PARTNER_REGISTRATION_TOKEN_EXPIRED
PARTNER_REGISTRATION_TOKEN_CONSUMED
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

Sensitive Partner/current-authorization responses use private/no-store semantics. Browser JavaScript never reads the session cookie.

## 18. Concurrency and idempotency

Required real PostgreSQL concurrency evidence:

```text
S3-CON01  profile edit vs submit
S3-CON02  payout-account replace vs submit
S3-CON03  evidence finalize vs submit
S3-CON04  approve vs request-changes
S3-CON05  approve vs reject
S3-CON06  two concurrent approvals
S3-CON07  stale reviewer expectedVersion vs newer resubmission
S3-CON08  suspend vs cancel
S3-CON09  reactivate vs cancel
S3-CON10  registration verification double-submit
S3-CON11  same registration token consumed concurrently
S3-CON12  duplicate registration completion cannot create duplicate Partner establishment
S3-CON13  suspended Partner stale session cannot execute protected Partner use case
S3-CON14  revoked/suspended PartnerMembership stale session cannot execute protected Partner use case
```

Registration completion is naturally idempotent through consumed challenge/establishment identity and transaction constraints.

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
S3-DB03 PartnerMembership cannot be retargeted to another tenant or Partner.
S3-DB04 PartnerRoleAssignment cannot be retargeted to another tenant/Partner/membership/role identity.
S3-DB05 Partner/PartnerMembership stable identity cannot be rewritten through direct UPDATE.
S3-DB06 Revoked membership/role assignment cannot be reactivated by clearing revoked_at.
S3-DB07 Evidence object identity/checksum/uploader cannot be rewritten.
S3-DB08 PartnerStatusHistory cannot be UPDATE/DELETE by booking_app.
S3-DB09 booking_app has exact required minimum DML and no excess DML.
S3-DB10 Missing app.tenant_id fails closed.
S3-DB11 FORCE RLS remains enabled and forced for every Partner-owned table.
S3-DB12 Partner-scope RoleAssignment validation accepts only approved partner-scope system roles.
```

Same-tenant Partner A/Partner B authorization is proved at application/API acceptance because tenant RLS intentionally does not provide nested Partner isolation.

## 20. Acceptance matrix

Primary Sprint 3 acceptance IDs:

| ID | Acceptance |
|---|---|
| `S3-PARTNER01` | Registration start is enumeration-safe and does not disclose account/Partner existence. |
| `S3-PARTNER02` | Email verification challenge is single-use, purpose/host/tenant-bound, hashed at rest, and raw-secret-safe. |
| `S3-PARTNER03` | Registration completion atomically establishes Partner + active initial PartnerMembership + `partner_owner`; concurrent retry does not duplicate establishment. |
| `S3-PARTNER04` | Existing global User is reused; new registration does not create a parallel credential/account system. |
| `S3-PARTNER05` | Partner session is exact-host/current-scope bound and reconciles User + Partner + PartnerMembership authorization versions. |
| `S3-PARTNER06` | Draft/changes-requested may edit; submitted application review material is frozen. |
| `S3-PARTNER07` | Submit requires complete type-specific profile, payout, evidence, and declarations. |
| `S3-PARTNER08` | Request-changes creates immutable findings; resubmit preserves review history. |
| `S3-PARTNER09` | Approve validates required verification/evidence under lock and atomically makes the Partner approved + active. |
| `S3-PARTNER10` | Reject is state-safe and preserves history/evidence/membership records. |
| `S3-PARTNER11` | Inactive/pending Partner may authenticate for onboarding but cannot pass future operational inventory policy. |
| `S3-PARTNER12` | Suspend/reactivate/cancel follow the state machine; cancel is terminal; Partner authorization-version invalidates stale sessions. |
| `S3-PARTNER13` | Partner A cannot read/write Partner B resources inside the same tenant through Partner self-service/resource policy. |
| `S3-PARTNER14` | Tenant A cannot read/write Tenant B Partner data through API or booking_app; missing tenant context fails closed. |
| `S3-PARTNER15` | Composite FK and stable-identity guards prevent cross-tenant/cross-Partner retargeting and historical authority reactivation. |
| `S3-PARTNER16` | Evidence storage is private, server-keyed, scan-gated, append/supersede, and unauthorized access fails closed. |
| `S3-PARTNER17` | Payout account is encrypted at rest, masked in DTOs, excluded from raw audit/logs, and replacement preserves history. |
| `S3-PARTNER18` | Required registration/review/lifecycle/stale-authority races converge deterministically on PostgreSQL. |
| `S3-PARTNER19` | Partner scope never unions Tenant permissions; explicit scope switch rotates session authority. |
| `S3-PARTNER20` | Partner registration for an existing active User requires normal account authentication before establishment; email verification alone is not a password bypass. |

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
- stale version;
- invalid lifecycle/application transition;
- incomplete verification;
- invalid/expired/consumed registration token;
- inactive PartnerMembership;
- suspended/cancelled Partner;
- wrong host/scope;
- unsafe Origin/missing CSRF.

## 23. Browser security acceptance

Critical browser acceptance proves:

- registration verification fragment is scrubbed before normal navigation/referrer/logging;
- raw registration token never reaches server access logs or analytics;
- `__Host-` cookie invariants remain intact;
- wrong-host and wrong-scope replay reject;
- Partner scope does not inherit Tenant permissions;
- scope switching rotates session material;
- unsafe requests require Origin + CSRF;
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
partner.membership.revoked
partner.role_assignment.granted
partner.role_assignment.revoked
```

Audit metadata may contain bounded identifiers/reference IDs, transition type, reason code, request ID, and safe result metadata.

Audit must never contain:

- raw registration/activation/session token;
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
2. registration challenge expired/consumed;
3. identity establishment failed before Partner commit;
4. suspected duplicate registration;
5. Partner application incorrectly approved;
6. Partner incorrectly suspended/reactivated/cancelled;
7. payout account reported incorrect/compromised;
8. evidence upload corrupted or quarantined;
9. stale Partner session after suspend/revoke;
10. Partner onboarding mutation outage;
11. cross-tenant/RLS incident response;
12. notification/outbox backlog.

Recovery must not recommend deleting history to reset state. Corrections use supported reversal/new workflow where available or a controlled, explicitly owned, audited database operation when product tooling does not yet exist.

## 26. Knowledge closeout

Implementation closeout must create/update at least:

```text
docs/features/FEATURE-0004-partner-onboarding.md
docs/patterns/<partner-authority-pattern>.md
docs/runbooks/partner-onboarding-recovery.md
docs/plan/90-DAY-EXECUTION.md
genesis/reviews/PILOT-GATES.md
```

Historical sprint-numbering ambiguity is reconciled as metadata/documentation; implementation is not rewritten merely to make old numbering match.

## 27. Explicit Sprint 3 exit criteria

Sprint 3 is complete only when all are true:

1. Partner registration email-link flow works end-to-end.
2. Existing global identity/shared password/session kernel is reused; no Partner auth stack exists in parallel.
3. Partner is a distinct authorization scope and does not require TenantMembership.
4. Partner scope never unions Tenant permission authority.
5. Partner aggregate supports individual/company onboarding and approved lifecycle transitions.
6. Tenant reviewer request-changes/approve/reject flow works with immutable review history.
7. Approval atomically makes the Partner application approved and operationally active.
8. Partner scope authority includes User + Partner + PartnerMembership versions, required permission, same-Partner resource policy, and lifecycle eligibility.
9. Same-tenant Partner A/B isolation is executable application/API evidence.
10. Cross-tenant Partner persistence is executable FORCE-RLS/composite-FK evidence.
11. Evidence is private, scan-gated, and append/supersede.
12. Payout account is encrypted/masked and raw values are absent from generic logs/audit/API DTOs.
13. Required concurrency and stale-authority cases pass against PostgreSQL.
14. Audit/history/outbox transaction semantics are executable evidence.
15. OpenAPI/generated-client and critical browser security gates pass.
16. Sprint 1B and Sprint 2 acceptance remain GREEN.
17. All protected repository gates are GREEN on exact final head.
18. Partner recovery/feature/pattern/roadmap closeout artifacts are complete.

Sprint 3 exit explicitly does **not** require listing, resource, availability, pricing, publication, booking, payment, finance, or payout execution.

## 28. Recommended implementation decomposition

The design is one coherent subsystem and can be executed through one detailed implementation plan, but the plan should preserve small TDD slices. Recommended task order:

1. Partner scope enums, Permission Catalog V2 additions, system-role/grant policy contracts.
2. Partner persistence schema, composite constraints, FORCE RLS, minimum DML, structural guards.
3. Partner domain model, ports, repositories, transaction session, and in-memory/unit contracts.
4. Registration challenge and identity-establishment application bridge.
5. Partner-scoped session/authorization-context extension and stale-authority reconciliation.
6. Partner self-service profile/payout/evidence/application use cases.
7. Tenant review/approve/reject use cases and optimistic/concurrency behavior.
8. Suspend/reactivate/cancel and Partner-wide authorization invalidation.
9. HTTP/OpenAPI/generated-client/browser security integration.
10. `S3-PARTNER01`–`S3-PARTNER20`, DB/concurrency acceptance command, protected CI integration.
11. Knowledge, runbook, reconciliation, and final verification closeout.

Production implementation must follow TDD: each task establishes a failing contract/evidence first, then the smallest production change that makes it pass, followed by protected verification before completion claims.

## 29. Design decisions intentionally deferred

The following decisions are not unresolved requirements for Sprint 3; they are intentionally deferred because their owning flows do not exist yet:

- Partner custom-role CRUD and Partner Role Builder UI;
- Partner member invitation/team-management product flow;
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
trusted tenant hostname
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
