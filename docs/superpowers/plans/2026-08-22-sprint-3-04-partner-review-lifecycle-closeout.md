# Sprint 3.4 Partner Review, Lifecycle & Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Tenant review/request-changes/approve/reject, Partner suspend/reactivate/cancel, stale-authority invalidation, full Sprint 3 acceptance evidence, observability, recovery knowledge, and a truthful technical closeout.

**Architecture:** Tenant governance routes use the existing Tenant authorization context plus capability permissions and same-tenant Partner resource policy. Review/lifecycle mutations lock Partner root first, validate `expectedVersion`, then update state + history + audit + outbox atomically. Partner-wide authority changes bump `Partner.authorization_version`, invalidating all Partner-scoped sessions without mass-updating memberships. PostgreSQL remains the cross-tenant boundary; same-tenant Partner isolation is proven at the application/API layer.

**Tech Stack:** Node.js >=22 <25, pnpm >=10 <11, TypeScript 5.9.3, NestJS 11.1.28, Prisma 6.19.3, PostgreSQL 17 FORCE RLS, Node test runner, Supertest, OpenAPI/generated client tooling, existing audit/outbox/metrics infrastructure, GitHub Actions protected gates.

**Spec:** `docs/superpowers/specs/2026-08-22-sprint-3-partner-foundation-onboarding-design.md`

## Global Constraints

- Plans 3.1-3.3 completion gates must be GREEN before this plan begins.
- Tenant reviewers must hold the exact `tenant.partner.*` capability and satisfy same-tenant resource policy; role-name checks alone are insufficient.
- `tenant_admin` may review/request changes/approve/reject by default; suspend/reactivate/cancel remain `tenant_owner`-governed initially.
- Tenant dynamic RBAC may delegate only catalog entries marked delegable; lifecycle cancel/suspend/reactivate remain non-delegable in Sprint 3.
- Review material is immutable while `submitted`; request-changes reopens editing; approve/reject operate only from `submitted`.
- Approval atomically sets `application_status=approved` and `operational_status=active`.
- Reject preserves Partner/membership/evidence/payout/history records.
- Cancel is terminal in Sprint 3.
- Partner-wide suspend/cancel/reactivate changes increment `Partner.authorization_version`; stale Partner sessions fail before protected logic.
- All sensitive mutations use `expectedVersion` and Partner-root locking.
- One real state transition produces one version increment and one required history/audit/outbox effect.
- Do not implement Catalog/listing/resource/scheduling/pricing/booking/payment in this plan.
- Do not call Sprint 3 complete until `verify:partner-onboarding` plus inherited protected gates are fresh-green on the same head.

---

## File Structure

- `apps/api/prisma/schema.prisma` — review findings and append-only status history.
- `apps/api/prisma/migrations/<timestamp>_partner_review_lifecycle/migration.sql` — tables, RLS, DML, immutable review/history guards.
- `apps/api/src/modules/partners/application/ports/partner-review-repository.port.ts` — findings/verification review persistence.
- `apps/api/src/modules/partners/application/ports/partner-status-history.port.ts` — append-only transition history.
- `apps/api/src/modules/partners/application/use-cases/request-partner-changes.ts` — submitted -> changes_requested.
- `apps/api/src/modules/partners/application/use-cases/approve-partner.ts` — submitted -> approved + active.
- `apps/api/src/modules/partners/application/use-cases/reject-partner.ts` — submitted -> rejected.
- `apps/api/src/modules/partners/application/use-cases/suspend-partner.ts` — active -> suspended.
- `apps/api/src/modules/partners/application/use-cases/reactivate-partner.ts` — suspended -> active.
- `apps/api/src/modules/partners/application/use-cases/cancel-partner.ts` — active|suspended -> cancelled.
- `apps/api/src/modules/partners/application/partner-inventory-eligibility.contract.ts` — exported future Catalog-facing active-Partner policy contract.
- `apps/api/src/modules/partners/infrastructure/http/tenant-partners.controller.ts` — Tenant review/lifecycle HTTP API.
- `apps/api/src/modules/partners/infrastructure/http/tenant-partners.dto.ts` — review/lifecycle DTOs.
- `apps/api/test/partner-review-concurrency.e2e.test.ts` — approve/reject/request-changes races.
- `apps/api/test/partner-lifecycle-concurrency.e2e.test.ts` — suspend/reactivate/cancel races.
- `apps/api/test/partner-tenant-api.e2e.test.ts` — tenant permission/resource isolation.
- `apps/api/test/partner-authority-reconciliation.e2e.test.ts` — stale Partner session fencing.
- `scripts/verify-partner-onboarding.mjs` — canonical Sprint 3 acceptance gate.
- `scripts/verify-partner-onboarding.test.mjs` — gate self-test/mapping.
- `package.json` — `verify:partner-onboarding` and inherited foundation chain.
- `.github/workflows/ci.yml` — protected Sprint 3 acceptance job after implementation is stable.
- `apps/api/src/common/security/security-audit-events.ts` — Partner audit event catalog.
- observability metrics files under the current API observability pattern — bounded Partner metrics.
- `docs/features/FEATURE-0004-partner-onboarding.md` — active feature truth.
- `docs/patterns/PATTERN-0005-partner-authority.md` — reusable Partner authority/state pattern.
- `docs/runbooks/partner-onboarding-recovery.md` — operational recovery.
- `docs/plan/90-DAY-EXECUTION.md`, `genesis/reviews/PILOT-GATES.md` — truthful roadmap/gate reconciliation.
- `tools/genesis/validator.py` and tests only if required to enforce the new knowledge artifacts.

### Task 1: Add immutable review findings and append-only Partner status history

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_partner_review_lifecycle/migration.sql`
- Modify: `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.ts`
- Test: `apps/api/test/partner-review-history-schema.integration.test.ts`

**Interfaces:**
- Consumes: Partner root and Partner verification items.
- Produces: `partner_review_findings` and `partner_status_history` with tenant-safe composite FKs and exact DML.

- [ ] **Step 1: Write RED schema/DML tests**

```ts
assert.equal(await isForceRls("partner_review_findings"), true);
assert.equal(await isForceRls("partner_status_history"), true);
assert.deepEqual(await privilegesFor("partner_status_history", "booking_app"), ["INSERT", "SELECT"]);
```

Direct `booking_app` UPDATE/DELETE on status history must fail. Finding identity/message/reviewer provenance must not be rewritable after insert; only resolution metadata may change.

- [ ] **Step 2: Prove RED**

```bash
node --test --test-concurrency=1 --import tsx apps/api/test/partner-review-history-schema.integration.test.ts
```

- [ ] **Step 3: Add Prisma models**

```prisma
model PartnerReviewFinding {
  id                          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId                    String   @db.Uuid @map("tenant_id")
  partnerId                   String   @db.Uuid @map("partner_id")
  category                    String
  code                        String
  message                     String
  createdByUserId             String   @db.Uuid @map("created_by_user_id")
  createdAt                   DateTime @default(now()) @db.Timestamptz(6) @map("created_at")
  resolvedAt                  DateTime? @db.Timestamptz(6) @map("resolved_at")
  resolvedBySubmissionVersion Int?     @map("resolved_by_submission_version")

  @@index([tenantId, partnerId])
  @@map("partner_review_findings")
}

model PartnerStatusHistory {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String   @db.Uuid @map("tenant_id")
  partnerId     String   @db.Uuid @map("partner_id")
  dimension     String
  fromStatus    String   @map("from_status")
  toStatus      String   @map("to_status")
  actorUserId   String   @db.Uuid @map("actor_user_id")
  reasonCode    String?  @map("reason_code")
  createdAt     DateTime @default(now()) @db.Timestamptz(6) @map("created_at")

  @@index([tenantId, partnerId, createdAt])
  @@map("partner_status_history")
}
```

- [ ] **Step 4: Add RLS, composite FKs, immutability triggers, exact grants**

`partner_review_findings`: `SELECT, INSERT, UPDATE`; trigger permits only resolution fields to change. `partner_status_history`: `SELECT, INSERT` only. Both use canonical `app.tenant_id` FORCE RLS and `(partner_id, tenant_id)` composite FK.

- [ ] **Step 5: Run GREEN DB gates and commit**

```bash
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm verify:migrations
pnpm --filter @booking-os/api test:e2e
```

```bash
git add apps/api/prisma apps/api/src/modules/tenancy apps/api/test/partner-review-history-schema.integration.test.ts
git commit -m "feat: add partner review history persistence"
```

### Task 2: Implement Tenant review, verification decisions, request-changes, approve, and reject

**Files:**
- Create: `apps/api/src/modules/partners/application/ports/partner-review-repository.port.ts`
- Create: `apps/api/src/modules/partners/application/ports/partner-status-history.port.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/get-partner-for-review.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/list-partners.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/update-partner-verification.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/request-partner-changes.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/approve-partner.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/reject-partner.ts`
- Create matching unit tests.
- Test: `apps/api/test/partner-review-concurrency.e2e.test.ts`

**Interfaces:**
- Consumes: Tenant authorization context/permission guard, Partner root lock, clean evidence, verification policy, `expectedVersion`, audit/outbox.
- Produces: concurrency-safe Tenant review state machine.

- [ ] **Step 1: Write RED permission/resource-policy tests**

Prove tenant admin with approved permission can review a same-tenant Partner, cannot review foreign tenant Partner, and cannot act solely because a route `partnerId` exists.

```ts
await assert.rejects(
  () => approve.execute(tenantAContext, { partnerId: tenantBPartner.id, expectedVersion: 4 }),
  PartnerNotFoundError,
);
```

- [ ] **Step 2: Write RED review-race tests**

Required controlled races:

```text
approve vs request-changes
approve vs reject
two concurrent approvals
stale reviewer version vs newer resubmission
```

Exactly one conflicting transition may commit from the same Partner version.

- [ ] **Step 3: Implement review repository/status history contracts**

```ts
export interface PartnerStatusHistoryPort {
  append(input: {
    partnerId: string;
    dimension: "application" | "operational";
    fromStatus: string;
    toStatus: string;
    actorUserId: string;
    reasonCode?: string;
  }): Promise<void>;
}
```

Review findings are insert-oriented and resolution metadata only is mutable.

- [ ] **Step 4: Implement verification decision use case**

Tenant reviewer may set verification item `verified|changes_required|rejected` only for a same-tenant submitted/changes workflow and only after evidence is `clean` when evidence is required. Record reviewer/time/reason without altering evidence provenance.

- [ ] **Step 5: Implement `RequestPartnerChanges`**

Lock order:

```text
Partner FOR UPDATE
-> expectedVersion
-> require submitted
-> insert findings
-> submitted -> changes_requested
-> Partner.version += 1
-> status history + audit + outbox
-> commit
```

- [ ] **Step 6: Implement `ApprovePartner` atomically**

Under Partner lock, re-read verification/payout/evidence state after the lock. Require every Partner-type-required verification item to be `verified` and all required evidence `clean`.

```text
application: submitted -> approved
operational: inactive -> active
approved_at = now
version += 1 exactly once
history(application) + history(operational)
audit partner.application.approved
outbox application-approved
commit
```

Do not publish inventory or create Catalog data.

- [ ] **Step 7: Implement `RejectPartner`**

Require `submitted`, set application status to `rejected`, leave operational status `inactive`, preserve all history/material, increment version once, append audit/history/outbox once.

- [ ] **Step 8: Run GREEN review suite and commit**

```bash
node --test --test-concurrency=1 --import tsx apps/api/test/partner-review-concurrency.e2e.test.ts
pnpm --filter @booking-os/api test
pnpm verify:dynamic-rbac
```

```bash
git add apps/api/src/modules/partners apps/api/test/partner-review-concurrency.e2e.test.ts
git commit -m "feat: add tenant partner review workflow"
```

### Task 3: Implement operational lifecycle, Partner-wide authorization invalidation, and future inventory eligibility contract

**Files:**
- Create: `apps/api/src/modules/partners/application/use-cases/suspend-partner.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/reactivate-partner.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/cancel-partner.ts`
- Create matching unit tests.
- Create: `apps/api/src/modules/partners/application/partner-inventory-eligibility.contract.ts`
- Modify: Partner repository for atomic authorization-version increment if required.
- Test: `apps/api/test/partner-lifecycle-concurrency.e2e.test.ts`
- Test: `apps/api/test/partner-authority-reconciliation.e2e.test.ts`

**Interfaces:**
- Consumes: Tenant-owner lifecycle permissions, Partner root/domain rules, session authoritative reconciliation.
- Produces: active/suspended/cancelled transitions, Partner-wide stale-session fencing, Catalog-facing eligibility contract without Catalog implementation.

- [ ] **Step 1: Write RED lifecycle/race tests**

```text
suspend vs cancel
reactivate vs cancel
stale Partner session after suspend
stale Partner session after cancel
fresh session after reactivate
```

`cancelled -> any state` must fail.

- [ ] **Step 2: Implement lifecycle mutations with one Partner authorization-version bump**

For suspend:

```text
lock Partner
-> expectedVersion
-> require active
-> operational_status = suspended
-> authorization_version += 1
-> version += 1
-> history + audit + outbox
-> commit
```

Reactivate requires `suspended` plus `application_status=approved`; cancel permits `active|suspended`, becomes terminal, increments both versions once.

- [ ] **Step 3: Prove stale sessions fail before protected work**

A session carrying old `partnerAuthorizationVersion` must be rejected/reconciled before entering Partner use-case transaction after suspend/cancel. Do not mass-update every PartnerMembership for Partner-wide lifecycle changes.

- [ ] **Step 4: Export future Catalog eligibility contract**

```ts
export interface PartnerInventoryEligibilityContract {
  assertCanCreateInventory(input: {
    tenantId: string;
    partnerId: string;
  }): Promise<void>;
}
```

Implementation loads authoritative Partner state and succeeds only when `operationalStatus === "active"`. It creates no listing/resource table.

- [ ] **Step 5: Run GREEN lifecycle tests and commit**

```bash
node --test --test-concurrency=1 --import tsx apps/api/test/partner-lifecycle-concurrency.e2e.test.ts
node --test --test-concurrency=1 --import tsx apps/api/test/partner-authority-reconciliation.e2e.test.ts
pnpm verify:identity-access
```

```bash
git add apps/api/src/modules/partners apps/api/test/partner-lifecycle-concurrency.e2e.test.ts apps/api/test/partner-authority-reconciliation.e2e.test.ts
git commit -m "feat: add partner operational lifecycle"
```

### Task 4: Expose Tenant Partner review/lifecycle HTTP API with exact permission matrix

**Files:**
- Create: `apps/api/src/modules/partners/infrastructure/http/tenant-partners.controller.ts`
- Create: `apps/api/src/modules/partners/infrastructure/http/tenant-partners.dto.ts`
- Create: `apps/api/src/modules/partners/infrastructure/http/tenant-partners.controller.test.ts`
- Modify: `apps/api/src/modules/partners/partners.module.ts`
- Create: `apps/api/src/openapi/tenant-partners-openapi.contract.test.ts`
- Generate: `packages/contracts/openapi/openapi.json`
- Generate: `packages/api-client/src/generated/schema.ts`
- Generate: `packages/api-client/src/generated/client.ts`
- Test: `apps/api/test/partner-tenant-api.e2e.test.ts`

**Interfaces:**
- Consumes: Tenant review/lifecycle use cases and current permission guard/decorator.
- Produces: `/tenant/partners*` API contract.

- [ ] **Step 1: Write RED HTTP permission matrix tests**

Routes:

```text
GET  /api/tenant/partners
GET  /api/tenant/partners/:partnerId
POST /api/tenant/partners/:partnerId/verification/:kind
POST /api/tenant/partners/:partnerId/request-changes
POST /api/tenant/partners/:partnerId/approve
POST /api/tenant/partners/:partnerId/reject
POST /api/tenant/partners/:partnerId/suspend
POST /api/tenant/partners/:partnerId/reactivate
POST /api/tenant/partners/:partnerId/cancel
```

Tenant admin succeeds for approved review capabilities, fails for lifecycle owner-only actions. Tenant owner succeeds. Foreign tenant Partner IDs return fail-closed not-found/denied semantics without existence leakage.

- [ ] **Step 2: Implement explicit command DTOs**

Sensitive commands carry `expectedVersion` plus bounded reason/finding data; never accept raw lifecycle status fields through generic PATCH.

```ts
export class ApprovePartnerDto {
  expectedVersion!: number;
}

export class RequestPartnerChangesDto {
  expectedVersion!: number;
  findings!: readonly { category: string; code: string; message: string }[];
}
```

- [ ] **Step 3: Preserve CSRF/Origin/private-cache rules**

Every unsafe route uses current exact-origin + CSRF protection. Sensitive reads/review responses are no-store and never expose raw payout account number or permanent evidence URL.

- [ ] **Step 4: Generate/check OpenAPI and run API E2E**

```bash
pnpm api:generate
pnpm api:check-generated
pnpm api:check-breaking
node --test --test-concurrency=1 --import tsx apps/api/test/partner-tenant-api.e2e.test.ts
```

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/api/src/modules/partners apps/api/src/openapi apps/api/test/partner-tenant-api.e2e.test.ts packages/contracts/openapi packages/api-client
git commit -m "feat: expose tenant partner governance api"
```

### Task 5: Build the canonical `S3-PARTNER01..18` acceptance gate and CI chain

**Files:**
- Create: `scripts/verify-partner-onboarding.mjs`
- Create: `scripts/verify-partner-onboarding.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Reuse/create focused acceptance files under `apps/api/test/`.

**Interfaces:**
- Consumes: all Sprint 3 behavior/evidence from Plans 3.1-3.4.
- Produces: one executable acceptance command and protected CI job.

- [ ] **Step 1: Write RED verifier self-test with exact acceptance IDs**

The verifier must map every ID exactly once:

```js
const REQUIRED = [
  "S3-PARTNER01", "S3-PARTNER02", "S3-PARTNER03", "S3-PARTNER04",
  "S3-PARTNER05", "S3-PARTNER06", "S3-PARTNER07", "S3-PARTNER08",
  "S3-PARTNER09", "S3-PARTNER10", "S3-PARTNER11", "S3-PARTNER12",
  "S3-PARTNER13", "S3-PARTNER14", "S3-PARTNER15", "S3-PARTNER16",
  "S3-PARTNER17", "S3-PARTNER18",
];
```

Fail if an ID has no executable evidence or is duplicated.

- [ ] **Step 2: Map acceptance IDs to focused executable tests**

Required coverage:

```text
01 enumeration-safe start
02 single-use bound token/no secret leak
03 atomic/idempotent establishment
04 global User reuse
05 Partner host/session/version binding
06 editable vs submitted freeze
07 Partner-type submit completeness
08 changes-requested/resubmit history
09 approve -> approved+active atomicity
10 reject preserves history
11 inactive cannot operate inventory; active can pass eligibility contract
12 suspend/reactivate/cancel + stale session
13 same-tenant Partner A/B API isolation
14 cross-tenant API + booking_app RLS + missing context
15 composite FK/stable identities/revocation guards
16 private evidence/superseding/download authorization
17 encrypted/masked payout/no raw audit leakage
18 required concurrency matrix
```

- [ ] **Step 3: Add root script**

```json
"verify:partner-onboarding": "node scripts/verify-partner-onboarding.mjs"
```

Update the foundation verification chain so Partner acceptance runs after identity-access + dynamic-RBAC and before final build/browser closeout.

- [ ] **Step 4: Add protected CI job**

CI order must preserve earlier gates and add a named `Sprint 3 Partner onboarding acceptance` step/job. Do not remove or weaken Sprint 1B/Sprint 2 checks.

- [ ] **Step 5: Run RED->GREEN acceptance verifier**

```bash
node --test scripts/verify-partner-onboarding.test.mjs
pnpm verify:partner-onboarding
```

- [ ] **Step 6: Commit Task 5**

```bash
git add scripts/verify-partner-onboarding.mjs scripts/verify-partner-onboarding.test.mjs package.json .github/workflows/ci.yml apps/api/test
git commit -m "test: add partner onboarding acceptance gate"
```

### Task 6: Add bounded observability, audit catalog, recovery runbook, feature/pattern knowledge, and roadmap reconciliation

**Files:**
- Modify: `apps/api/src/common/security/security-audit-events.ts`
- Modify: `apps/api/src/common/security/security-audit-events.test.ts`
- Modify/create Partner metrics adapter/tests following current observability conventions.
- Create: `docs/features/FEATURE-0004-partner-onboarding.md`
- Create: `docs/patterns/PATTERN-0005-partner-authority.md`
- Create: `docs/runbooks/partner-onboarding-recovery.md`
- Modify: `docs/plan/90-DAY-EXECUTION.md`
- Modify: `genesis/reviews/PILOT-GATES.md`
- Modify: `tools/genesis/validator.py` and matching tests only when required to make knowledge artifacts enforceable.

**Interfaces:**
- Consumes: final behavior and exact gate evidence.
- Produces: production-safe metrics/audit and truthful closeout knowledge.

- [ ] **Step 1: Close the Partner audit event catalog with RED tests**

Required events include:

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

Audit sanitizer tests must reject raw token/cookie/CSRF/header/account number/signed URL/evidence content.

- [ ] **Step 2: Add bounded metrics**

Use only bounded labels:

```text
partner_registration_started_total{result}
partner_registration_completed_total{result}
partner_application_transition_total{transition,result}
partner_verification_transition_total{kind,result}
partner_evidence_finalize_total{result}
partner_payout_account_change_total{result}
partner_authorization_reconciliation_total{result}
```

No tenant/user/Partner/email/object key/account labels.

- [ ] **Step 3: Write recovery runbook with executable-safe recovery policy**

Document exact response for registration delivery/token issues, duplicate suspicion, mistaken approval/suspension, payout compromise, evidence quarantine/corruption, stale sessions, onboarding outage, RLS incident, and stuck outbox. Recovery must preserve history; no instruction may recommend deleting audit/status records to reset state.

- [ ] **Step 4: Write feature/pattern docs and reconcile roadmap**

`FEATURE-0004` records current implemented behavior and `verify:partner-onboarding`. `PATTERN-0005` records Partner sub-scope authority, Partner authorization version, resource policy, and cross-tenant RLS split. Update 90-Day and Pilot Gates to mark Partner foundation delivered without pretending Catalog/Availability/Pricing are delivered.

- [ ] **Step 5: Run knowledge/secret-safety gates and commit**

```bash
pnpm genesis:validate
pnpm verify:delivery-reconciliation
pnpm test:scripts
```

```bash
git add apps/api/src/common/security apps/api/src/observability docs genesis tools
git commit -m "docs: close out partner onboarding"
```

### Task 7: Execute the full same-head Sprint 3 completion gate and prepare review handoff

**Files:**
- Modify only for evidence-driven fixes.
- No PR Ready/reviewer/merge mutation in this task.

**Interfaces:**
- Consumes: all Sprint 3 tasks.
- Produces: exact closeout SHA and evidence set for external review.

- [ ] **Step 1: Run static/architecture/generated checks**

```bash
pnpm genesis:validate
pnpm verify:delivery-reconciliation
pnpm check:ci
pnpm verify:architecture
pnpm verify:frontend-libraries
pnpm lint
pnpm typecheck
pnpm api:check-generated
pnpm api:check-breaking
pnpm infra:config
```

- [ ] **Step 2: Run database and full API acceptance**

```bash
pnpm --filter @booking-os/api prisma:validate
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm verify:migrations
pnpm test
pnpm test:e2e:api
pnpm verify:identity-access
pnpm verify:dynamic-rbac
pnpm verify:partner-onboarding
```

- [ ] **Step 3: Run build/browser/production checks**

```bash
pnpm build
pnpm test:e2e
pnpm verify:production-config
```

- [ ] **Step 4: Verify working tree and capture exact SHA**

```bash
git status --short
git rev-parse HEAD
```

Expected: clean worktree.

- [ ] **Step 5: Verify protected GitHub workflows on that exact SHA**

Require fresh-green CI, architecture, identity-email, and any other protected repository workflows. If a workflow fails, inspect its exact assertion/artifact before changing production code.

- [ ] **Step 6: Update Draft Sprint 3 PR body with exact evidence only**

Record task RED/GREEN commits, final SHA, workflow run IDs, acceptance command, and any known deferred scope. Keep the PR Draft unless the user explicitly instructs otherwise. Do not request/fabricate reviewers and do not merge.

## Sprint 3 Completion Gate

- [ ] `S3-PARTNER01`-`S3-PARTNER18` all resolve to passing executable evidence via `pnpm verify:partner-onboarding`.
- [ ] Required `P3-DB01..10` and `P3-CON01..14` behaviors are represented by PostgreSQL/API tests, not only in-memory fakes.
- [ ] Tenant reviewer request-changes/approve/reject respects exact permissions and same-tenant Partner resource policy.
- [ ] Approval atomically produces `approved + active`; rejection preserves all history/material.
- [ ] Suspend/reactivate/cancel obey state rules; cancel is terminal; Partner authorization version fences stale sessions.
- [ ] `PartnerInventoryEligibilityContract` allows only active Partners and creates no Catalog entities.
- [ ] Same-tenant Partner A/B isolation and cross-tenant FORCE-RLS isolation are both independently proven.
- [ ] Evidence remains private/safe and payout data remains encrypted/masked/secret-safe.
- [ ] Audit/history/outbox semantics are transactional and one-real-transition/one-side-effect.
- [ ] OpenAPI/generated client, browser security, identity-access, dynamic-RBAC, migrations, architecture, build, production config, dependency audit, and secret scan are fresh-green on the exact closeout SHA.
- [ ] Feature/pattern/runbook/roadmap/Pilot knowledge is current and Genesis validation passes.
- [ ] Listing/resource/catalog, schedule, pricing, booking/payment, Partner custom roles, and full Role Builder remain explicitly out of scope.
- [ ] Review handoff is truthful; no automatic Ready/reviewer/merge action occurs.
