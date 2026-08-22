# Sprint 3 — Partner Foundation & Onboarding Design

**Date:** 2026-08-22  
**Status:** Approved design, pre-implementation  
**Scope:** Partner Foundation & Onboarding  
**Source order:** dated amendments/ADRs → active architecture/design → current code/tests/contracts → historical plans

## 1. Context

Booking OS has completed the shared identity/session/authorization kernel and the Tenant dynamic RBAC foundation. The current 90-Day roadmap places Partner onboarding ahead of Catalog, Availability, and Pricing. The older Pilot Design used stale sprint numbering in which Partner Onboarding was Sprint 2 and Bookable Inventory was Sprint 3; that numbering is metadata drift, not authorization to skip Partner delivery.

Sprint 3 therefore introduces the Partner domain as a new bounded module and extends the existing global identity, opaque-session, authorization, PostgreSQL RLS, audit, and outbox foundations. It does not create a second authentication stack and it does not pull Catalog/listing/resource/schedule/pricing, booking/payment, or full Partner Role Builder functionality into this sprint.

The exit condition is an approved, active, securely authorized Partner that is ready to become an inventory owner in the next product slice.

## 2. Goals

Sprint 3 must provide a production-shaped Partner onboarding vertical slice with these capabilities:

- Partner registration through a single-use email verification link.
- Reuse of the canonical global User identity and shared host-bound opaque session kernel.
- Partner profiles for both `individual` and `company` Partner types.
- Payout account capture with masked reads and encrypted-at-rest sensitive account material.
- Management-right and other required verification evidence using private object storage.
- Draft → submit → tenant review → changes requested / approve / reject onboarding flow.
- Partner operational lifecycle with `inactive`, `active`, `suspended`, and `cancelled` behavior.
- Authoritative Partner authorization scope built on User + TenantMembership + Partner + PartnerMembership.
- PostgreSQL FORCE RLS for every Partner-owned tenant table and same-tenant composite referential integrity.
- Concurrency-safe review and lifecycle transitions, transactional audit/history/outbox, and stale-authority invalidation.
- Executable acceptance evidence through `pnpm verify:partner-onboarding` while keeping all protected Sprint 1B and Sprint 2 gates blocking.

## 3. Non-goals

Sprint 3 explicitly excludes:

- listing/resource/catalog entities;
- schedule, exception, resource block, buffer, and availability calculation;
- pricing and quote snapshots;
- publication/moderation/searchable storefront inventory;
- booking/payment/ledger/settlement implementation;
- full subscription/billing cleanup merely because older roadmap items remain incomplete;
- full Partner custom-role CRUD or three-level Platform/Tenant/Partner Role Builder UI;
- Partner-specific credential storage, bearer-token auth, or a separate Partner authentication service;
- partner-level PostgreSQL session context such as `app.partner_id`.

## 4. Architectural boundary

The new module follows the accepted minimal hexagonal module layout:

```text
apps/api/src/modules/partners/
├── domain/
├── application/
│   ├── ports/
│   └── use-cases/
├── infrastructure/
│   ├── http/
│   └── persistence/
└── partners.module.ts
```

Dependency direction is:

```text
infrastructure → application → domain
```

The `partners` module owns:

- Partner aggregate and lifecycle;
- PartnerProfile;
- PartnerMembership and Partner authority state;
- verification item state;
- Partner review findings/history;
- evidence metadata;
- payout account metadata/state;
- Partner-specific audit/outbox events and eligibility policies.

It does not own generic User credentials, secure token primitives, opaque session machinery, TenantMembership, Catalog/listing persistence, scheduling, booking, or payments.

Cross-module communication must use exported application-facing contracts. The Partner module must never import another module's persistence adapter or database table as an application contract.

## 5. Identity and authorization model

Partner is an authorization sub-scope inside a Tenant, not a Tenant and not a separate authentication realm.

```text
Global User
   │
   └── TenantMembership
          │
          └── PartnerMembership
                 │
                 └── Partner
```

The shared identity model remains canonical:

- one global User identity;
- tenant participation through TenantMembership;
- Partner participation through PartnerMembership;
- host-bound opaque server-side browser sessions;
- server-authoritative authority rebuilt/reconciled before protected work.

Sprint 3 extends the authorization scope model to support `partner` in the same architecture used by Platform and Tenant scopes. A Partner-scoped session binds at least:

- exact trusted hostname;
- User identity;
- Tenant identity;
- Partner identity;
- User authorization version;
- TenantMembership authorization version;
- Partner authorization version;
- PartnerMembership authorization version.

Client-supplied `tenantId` or `partnerId` is never authority. Tenant identity comes from trusted host/session context and Partner identity comes from the authenticated Partner-scoped session. Route IDs are resource identifiers only and are always checked against authoritative context.

## 6. Partner system-role foundation

Sprint 3 seeds only the Partner system-role foundation required for approved product flows:

- `partner_owner`
- `partner_admin`

The first verified registrant becomes `partner_owner` for the newly established Partner.

Full dynamic Partner custom-role CRUD is deferred until Partner product flows require it. Sprint 3 must not pre-create unused role-builder capability.

## 7. Permission model

Permission Catalog V2 remains code-owned and append-only. Sprint 3 adds only permissions needed by its protected use cases.

Partner-scoped capabilities:

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

Tenant-scoped Partner governance capabilities:

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

Default system-role grant policy:

- `partner_owner`: all Partner self-service capabilities.
- `partner_admin`: Partner profile/application/verification reads and permitted onboarding updates, but no payout-account replacement by default.
- `tenant_admin`: tenant Partner review capabilities, including request-changes / approve / reject, but no destructive operational lifecycle by default.
- `tenant_owner`: full tenant Partner governance including suspend/reactivate/cancel.

Tenant Partner review capabilities may be made tenant-delegable through the already delivered Tenant dynamic RBAC mechanism. `tenant.partner.lifecycle.cancel` remains owner-governed/non-delegable in Sprint 3; suspend/reactivate are also owner-governed initially because later inventory/booking semantics may make them operationally high impact.

Effective Partner authority is:

```text
authenticated Partner session
AND active TenantMembership
AND active PartnerMembership
AND required permission
AND same-resource policy
AND valid Partner lifecycle state
```

Having a permission does not bypass lifecycle policy. A pending/inactive Partner may authenticate and complete onboarding but may not operate inventory.

## 8. Partner aggregate and state machines

### 8.1 Partner root

Conceptual Partner root:

```text
Partner
├── id
├── tenant_id
├── type: individual | company
├── application_status
├── operational_status
├── authorization_version
├── version
├── submitted_at
├── approved_at
├── suspended_at
├── cancelled_at
├── created_at
└── updated_at
```

Child concepts include PartnerProfile, PartnerMembership, PartnerVerificationItem, PartnerReviewFinding, PartnerEvidence, PartnerPayoutAccount, and PartnerStatusHistory.

### 8.2 Application lifecycle

```text
draft
  └─ submit ─► submitted
                  ├─ request changes ─► changes_requested ── resubmit ─► submitted
                  ├─ approve ─────────► approved
                  └─ reject ──────────► rejected
```

Rules:

- `draft` and `changes_requested` are editable Partner states.
- `submitted` freezes review material from normal Partner self-service mutation.
- `approved` and `rejected` are terminal for the onboarding application represented by this lifecycle.
- post-approval material changes belong to a later amendment/re-verification workflow, not a rewrite of original onboarding history.

### 8.3 Operational lifecycle

```text
inactive ── approval ─► active
active ── suspend ────► suspended
suspended ─ reactivate ► active
active|suspended ─ cancel ► cancelled
```

`cancelled` is terminal in Sprint 3.

Creation starts as:

```text
application_status = draft
operational_status = inactive
```

Approval atomically changes:

```text
application_status: submitted → approved
operational_status: inactive → active
```

## 9. Verification and review model

Verification is not a single boolean. PartnerVerificationItem records represent required review dimensions such as:

```text
identity
business_registration
payout_account
management_rights
```

Each item has status:

```text
pending
verified
changes_required
rejected
```

Required verification differs by Partner type. An `individual` Partner does not need the same business-registration evidence as a `company` Partner. Submit validates completeness; approve validates final verification readiness under lock.

Tenant review findings are append-oriented structured records containing bounded category/code/message and reviewer provenance. Reviewer comments are immutable after creation except explicit resolution metadata. Resubmission never destroys previous findings.

## 10. Registration and email verification

Partner registration uses the existing secure-token infrastructure with a dedicated purpose such as `partner_registration`.

Flow:

```text
registration start
→ normalize email
→ find/create canonical global User as appropriate
→ issue purpose/host/tenant/user-bound verification challenge
→ send email link
→ browser verifies single-use challenge
→ atomically establish Partner + PartnerMembership + partner_owner assignment
→ commit
→ rotate/issue Partner-scoped opaque session
→ onboarding
```

The verification secret must be:

- single-use;
- short-lived;
- purpose-bound;
- exact-host-bound;
- tenant-bound;
- subject-bound;
- persisted as selector + keyed digest rather than raw token material.

Registration start must be enumeration-safe and must not reveal whether the email already belongs to a User or Partner.

Double-clicks/retries/concurrent consumption must converge to one established Partner relationship and must not create duplicates.

## 11. Browser/session security

Partner authentication remains the shared host-bound opaque-session model. Scope elevation rotates session material to prevent fixation.

For state-changing session-authenticated requests, the existing exact approved Origin + CSRF + host-bound session contract remains mandatory.

Wrong-host, wrong-tenant, wrong-Partner, stale-version, inactive membership, suspended Partner, or cancelled Partner authority fails closed.

Sensitive Partner browser/API surfaces use private/no-store behavior consistent with the existing identity-access security model.

## 12. HTTP/API boundary

Partner self-service routes are conceptually scoped as `/partner/me/*` so Partner authority is derived from the session rather than a client-selected Partner ID.

Representative routes:

```text
GET    /partner/me
PATCH  /partner/me/profile
GET    /partner/me/application
POST   /partner/me/application/submit
GET    /partner/me/verification
PUT    /partner/me/verification/:kind
GET    /partner/me/payout-account
PUT    /partner/me/payout-account
GET    /partner/me/review-findings
```

Tenant review routes use resource identifiers but always enforce same-tenant resource policy:

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

Sensitive transitions use explicit command endpoints rather than allowing generic PATCH of lifecycle fields.

Mutations carry `expectedVersion` where stale intent matters. Version mismatch returns a stable conflict contract; the API must not silently re-run a stale business decision against newer state.

Foreign/inaccessible identifiers use fail-closed not-found/denied semantics without existence leakage.

## 13. Application use cases

### Public registration

- `StartPartnerRegistration`
- `CompletePartnerRegistration`

### Partner self-service

- `GetPartnerSelf`
- `UpdatePartnerProfile`
- `CreateEvidenceUploadIntent`
- `FinalizePartnerEvidence`
- `SetPartnerPayoutAccount`
- `GetPartnerApplication`
- `SubmitPartnerApplication`
- `ListPartnerReviewFindings`

### Tenant operations

- `ListPartners`
- `GetPartnerForReview`
- `RequestPartnerChanges`
- `ApprovePartner`
- `RejectPartner`
- `SuspendPartner`
- `ReactivatePartner`
- `CancelPartner`

Controllers invoke these use cases. Prisma and row-locking details remain in infrastructure adapters.

## 14. Persistence model

Tenant-owned Partner tables include at least:

```text
partners
partner_profiles
partner_memberships
partner_verification_items
partner_review_findings
partner_evidence
partner_payout_accounts
partner_status_history
```

Every tenant-owned table carries `tenant_id`. The Partner root exposes a composite stable identity:

```text
UNIQUE (id, tenant_id)
```

Partner child tables carry `partner_id` + `tenant_id` and use composite FKs back to Partner. PartnerMembership also carries `tenant_membership_id` + `tenant_id` and uses a composite FK to TenantMembership so cross-tenant retargeting is structurally impossible.

PartnerMembership identity tuple `(tenant_id, partner_id, tenant_membership_id)` is immutable after creation. Revocation is monotonic; a revoked membership cannot be silently reactivated by clearing `revoked_at`.

## 15. PostgreSQL FORCE RLS

All Partner-owned tenant tables must have:

```text
ENABLE ROW LEVEL SECURITY
FORCE ROW LEVEL SECURITY
```

Normal application policies use the canonical transaction-local tenant context:

```text
tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
```

No Sprint 3 table adds `app.partner_id` RLS context.

Security boundary:

- PostgreSQL FORCE RLS protects Tenant A vs Tenant B.
- application/resource authorization protects Partner A vs Partner B inside the same Tenant.

Missing `app.tenant_id` must fail closed through the normal application role.

## 16. Minimum-DML privileges

`booking_app` receives only the privileges required by normative use cases. Business/history tables are not granted broad CRUD by default.

Expected shape:

```text
partners                    SELECT INSERT UPDATE
partner_profiles            SELECT INSERT UPDATE
partner_memberships         SELECT INSERT UPDATE
partner_verification_items  SELECT INSERT UPDATE
partner_review_findings      SELECT INSERT UPDATE
partner_evidence            SELECT INSERT UPDATE
partner_payout_accounts     SELECT INSERT UPDATE
partner_status_history      SELECT INSERT
```

No normal hard-delete behavior is required for Sprint 3 Partner history. Revocation, cancellation, superseding, and append-only history preserve provenance.

The tenant policy manifest / migration verification must assert exact privileges, RLS presence, non-null tenant columns where required, and policy drift.

## 17. Database structural invariants

Database enforcement is limited to structural impossibilities valuable even under direct DML. It does not replicate the entire Partner business state machine.

Required structural guards include:

- Partner `id` and `tenant_id` cannot be retargeted.
- PartnerMembership tenant/Partner/TenantMembership identity cannot be retargeted.
- revoked PartnerMembership cannot be reactivated by direct DML.
- PartnerEvidence identity/object-key/checksum provenance cannot be rewritten in place.
- PartnerStatusHistory is append-only to `booking_app`.
- same-tenant composite FKs prevent cross-tenant association.
- payout/evidence historical records use superseding records rather than rewriting history.

Workflow authorization, reason semantics, verification completeness, and lifecycle transitions remain domain/application responsibilities.

## 18. Evidence storage security

Verification evidence lives in a private object-storage boundary, separate from public listing/media delivery.

Object keys are generated by the server and contain opaque identifiers only. Email, company name, bank account material, or other sensitive values must not appear in object paths.

Upload flow:

```text
Partner session
→ authorize upload intent
→ server-generated object id/key
→ short-lived restricted upload capability
→ upload
→ verify metadata/checksum/safety state
→ persist PartnerEvidence metadata
```

Evidence metadata records at least object key, content type, bounded size, checksum, uploader, timestamps, verification association, and superseding state.

Replacing evidence creates a new evidence record and supersedes the previous record; it does not overwrite the old object's provenance.

Reviewer downloads require a fresh authorized server-side decision and short-lived download capability or streamed response. Permanent public URLs are forbidden.

Files use content-type/size allowlists, server-generated paths, safe Content-Disposition behavior, and a malware-safety state. If scanning is asynchronous, evidence is not reviewer-consumable until safe.

## 19. Payout-account security

Payout account data is not stored in generic JSON and raw account numbers are never returned by normal read APIs or recorded in audit metadata.

Conceptual persistence:

```text
partner_payout_accounts
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

Raw account material is encrypted through an application-facing crypto capability before persistence. Default reads expose only masked data. Replacement supersedes the previous record and inserts a new current record, preserving historical provenance.

## 20. Transaction strategy and lock ordering

Partner mutations execute inside tenant-scoped transactions that establish `booking_app` and transaction-local `app.tenant_id` before tenant-owned work.

Canonical ordering:

```text
Tenant / identity prerequisite
→ Partner
→ PartnerMembership
→ PartnerProfile
→ VerificationItem (stable sorted order)
→ PayoutAccount
→ Evidence (stable sorted order)
→ ReviewFinding
→ History / Audit / Outbox append
```

Use cases may not invent conflicting lock order.

### Submit

`SubmitPartnerApplication(expectedVersion)` locks Partner, validates expected version and editable state, reads/locks required onboarding material, validates completeness, moves to `submitted`, increments Partner version, and appends history/audit/outbox in the same transaction.

### Request changes

Locks Partner, requires `submitted`, validates reviewer authority, inserts immutable findings, transitions to `changes_requested`, increments version, and appends history/audit/outbox.

### Approve

Locks Partner, validates expected version and `submitted` state, validates required verification/evidence/payout state under the same transaction, and atomically changes application status to `approved` and operational status to `active`. History/audit/outbox commit with the state change.

### Reject

Locks Partner, requires a valid review state, moves application to `rejected`, keeps operational state inactive, and preserves all historical records.

### Suspend / reactivate / cancel

All lock Partner root. Suspend is valid from active, reactivate from suspended only while onboarding remains approved, and cancel is terminal.

## 21. Authorization-version invalidation

Partner root carries `authorization_version`; PartnerMembership carries its own authorization version.

Authority-changing Partner-wide transitions such as suspend/cancel increment Partner authorization version so every Partner-scoped session becomes stale without mass-updating all memberships.

Membership-specific revocation/suspension increments PartnerMembership authorization version.

Normal profile, evidence, or payout edits do not increment authorization version because they do not change permission authority.

Protected requests reconcile these snapshots before application logic executes.

## 22. Audit, history, and outbox

Important Partner transitions are auditable and use bounded, secret-safe metadata. Required event families include:

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
```

Audit must never contain raw verification tokens, cookies, session material, CSRF/Authorization headers, raw evidence documents, signed object URLs, full payout account numbers, or email bodies.

Where atomicity is required, state mutation + history + audit + outbox share one transaction. Notification delivery occurs after commit through the outbox/worker path; external email delivery is never performed inside the database transaction.

## 23. Observability

Metrics use bounded dimensions only, for example:

```text
partner_registration_started_total{result}
partner_registration_completed_total{result}
partner_application_transition_total{transition,result}
partner_verification_transition_total{kind,result}
partner_evidence_finalize_total{result}
partner_payout_account_change_total{result}
partner_authorization_reconciliation_total{result}
```

Raw tenant IDs, Partner IDs, User IDs, emails, object keys, and payout data are forbidden as metric labels.

Structured logs may carry request ID, operation name, bounded transition type, result, and stable safe error code; secrets and sensitive payloads remain excluded.

## 24. Concurrency requirements

Required PostgreSQL-backed races include:

```text
P3-CON01  edit profile vs submit
P3-CON02  replace payout account vs submit
P3-CON03  evidence finalize vs submit
P3-CON04  approve vs request-changes
P3-CON05  approve vs reject
P3-CON06  concurrent approvals
P3-CON07  stale reviewer expectedVersion vs resubmission
P3-CON08  suspend vs cancel
P3-CON09  reactivate vs cancel
P3-CON10  registration verification double-submit
P3-CON11  concurrent consumption of one verification token
P3-CON12  concurrent registration attempts cannot duplicate establishment
P3-CON13  suspended Partner stale session loses protected authority
P3-CON14  revoked PartnerMembership stale session loses protected authority
```

One real transition produces one state change, one version advance, and one corresponding transactional history/audit/outbox effect. Stale competing decisions fail deterministically.

## 25. Database acceptance requirements

Required PostgreSQL/RLS evidence includes:

```text
P3-DB01  Tenant A cannot SELECT Partner of Tenant B
P3-DB02  Tenant A cannot INSERT child row for Tenant B Partner
P3-DB03  PartnerMembership cannot reference foreign-tenant TenantMembership
P3-DB04  partner_id / tenant_id identities cannot be retargeted
P3-DB05  revoked PartnerMembership cannot be reactivated by direct DML
P3-DB06  evidence identity/object key cannot be rewritten
P3-DB07  history cannot be UPDATE/DELETE by booking_app
P3-DB08  booking_app has exact minimum DML, no excess privilege
P3-DB09  missing app.tenant_id fails closed
P3-DB10  FORCE RLS remains enabled on every Partner-owned tenant table
```

Same-tenant Partner A/B isolation is separately proven at the application/resource-policy layer because tenant RLS intentionally does not distinguish Partners inside one Tenant.

## 26. Primary acceptance matrix

Sprint 3 defines `S3-PARTNER01` through `S3-PARTNER18`:

1. `S3-PARTNER01` — Registration start is enumeration-safe.
2. `S3-PARTNER02` — Email verification token is single-use, purpose/host/tenant/user-bound, hashed at rest, and secret-safe.
3. `S3-PARTNER03` — Registration completion atomically establishes Partner + PartnerMembership + `partner_owner`; retries/races do not duplicate establishment.
4. `S3-PARTNER04` — Existing global User identities are reused; no duplicate Partner credential system appears.
5. `S3-PARTNER05` — Partner-scoped opaque session preserves host/scope/version invariants and wrong-host/wrong-scope replay fails closed.
6. `S3-PARTNER06` — Draft/changes-requested material is editable; submitted review material cannot be silently mutated.
7. `S3-PARTNER07` — Submit enforces type-specific profile/payout/evidence/declaration completeness.
8. `S3-PARTNER08` — Request-changes findings are immutable/history-preserving and resubmission keeps provenance.
9. `S3-PARTNER09` — Approval requires valid submitted state and required verification, then atomically activates the Partner.
10. `S3-PARTNER10` — Reject preserves Partner history/evidence/membership and does not hard-delete onboarding provenance.
11. `S3-PARTNER11` — Pending/inactive Partner may authenticate but may not pass inventory eligibility; only active Partner can later own operational inventory.
12. `S3-PARTNER12` — Suspend/reactivate/cancel obey the lifecycle and stale Partner authority is invalidated.
13. `S3-PARTNER13` — Partner A cannot read/write Partner B inside the same Tenant through self-service/resource policy.
14. `S3-PARTNER14` — Tenant A cannot read/write Tenant B Partner data through API or normal `booking_app`; missing tenant context fails closed.
15. `S3-PARTNER15` — Composite FKs and structural guards prevent foreign-tenant references and identity retargeting.
16. `S3-PARTNER16` — Evidence storage is private, server-keyed, superseding, and authorization protected.
17. `S3-PARTNER17` — Payout account material is encrypted/masked and secret-safe in API/audit behavior.
18. `S3-PARTNER18` — Required concurrency matrix converges deterministically against PostgreSQL.

Primary acceptance command:

```bash
pnpm verify:partner-onboarding
```

## 27. Protected CI gates

Sprint 3 is not complete merely because its own acceptance suite is green. Protected verification must also keep current repository gates blocking, including as applicable:

```text
format/lint/typecheck
architecture boundaries
Prisma validation
migration verification
OpenAPI generated-client compatibility
unit tests
API E2E + RLS
identity-access acceptance
Sprint 2 dynamic-RBAC acceptance
browser/security smoke
production-config guard
dependency audit
committed-secret scan
build
knowledge/delivery-reconciliation validation
```

Required closeout truth is:

```text
Sprint 3 GREEN
AND Sprint 2 GREEN
AND Sprint 1B GREEN
AND protected repository CI GREEN
```

## 28. OpenAPI and browser acceptance

Server DTO/controller changes flow through generated OpenAPI and generated client artifacts. Frontend code must not create a parallel hand-maintained Partner API type system.

Negative contracts must cover foreign Partner access, stale version, invalid lifecycle, expired/consumed registration token, verification incomplete, inactive PartnerMembership, suspended/cancelled Partner, unsafe Origin, and missing CSRF.

Browser registration acceptance must prove verification-secret scrubbing/non-leakage, host-only session behavior, post-establishment Origin+CSRF enforcement, private/no-store surfaces, wrong-host replay rejection, and absence of raw payout data in generic diagnostics.

## 29. Recovery and operational knowledge

Sprint 3 closeout adds a Partner onboarding recovery runbook covering at least:

- missing verification email;
- expired/consumed verification challenge;
- failed establishment transaction;
- suspected duplicate registration;
- incorrect approval;
- incorrect suspension;
- incorrect/compromised payout account;
- quarantined/corrupted evidence;
- stale sessions after revoke/suspend;
- Partner onboarding mutation outage;
- suspected cross-tenant/RLS incident;
- stuck notification outbox.

Recovery must preserve history. It must not recommend deleting audit/review records merely to reset state.

Expected knowledge updates after implementation include:

```text
docs/features/FEATURE-0004-partner-onboarding.md
docs/patterns/<partner-authority-pattern>.md
docs/runbooks/partner-onboarding-recovery.md
docs/plan/90-DAY-EXECUTION.md
genesis/reviews/PILOT-GATES.md
```

Historical sprint numbering conflicts are reconciled as metadata, not by reshaping product code to match stale sequencing.

## 30. Explicit exit criteria

Sprint 3 is complete only when all of the following are true:

1. Partner registration by email verification link works end-to-end.
2. Canonical global identity and shared opaque-session kernel are reused; no Partner auth stack exists.
3. Individual/company Partner onboarding follows the approved state machines.
4. Tenant reviewer can request changes, approve, and reject under authoritative permission/resource policy.
5. Approval atomically makes the Partner operationally active.
6. Partner scope authority uses User + TenantMembership + Partner + PartnerMembership + permission + lifecycle/resource policy.
7. Same-tenant Partner A/B isolation is proven at the application boundary.
8. Cross-tenant Partner persistence is proven with FORCE RLS, composite FKs, and exact minimum-DML under `booking_app`.
9. Evidence storage is private and payout account material is encrypted/masked.
10. Required concurrency and stale-authority races have PostgreSQL-backed executable evidence.
11. Audit/history/outbox preserve required transaction semantics and secret safety.
12. OpenAPI/generated-client and browser security gates are green.
13. Sprint 1B, Sprint 2, and protected repository CI have no regression.
14. Required feature/pattern/recovery/roadmap knowledge artifacts are reconciled.

Sprint 3 exit does **not** require listing/resource/schedule/pricing implementation. It establishes a secure active Partner foundation ready for the following inventory slice.

## 31. Branching and implementation dependency

This design document is intentionally isolated from the existing Sprint 2 Draft PR. Sprint 2 remains frozen while external review/handoff is pending.

Implementation must not silently stack production code on an unmerged Sprint 2 branch. Before Sprint 3 implementation starts, the implementation plan must resolve branch dependency explicitly:

- preferred: Sprint 2 is reviewed/merged, then Sprint 3 branches from updated `main`;
- fallback only if explicitly chosen: a clearly documented stacked Sprint 3 branch based on Sprint 2 head, with dependency/rebase consequences made explicit.

No implementation plan or code is authorized by this design document alone. After this spec is reviewed, the next workflow step is a separate implementation plan produced under the project planning/TDD workflow.
