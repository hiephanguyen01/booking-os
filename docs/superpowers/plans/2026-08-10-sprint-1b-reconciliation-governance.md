# Sprint 1B Reconciliation and Agent Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile Sprint 1B design/plan/roadmap with the implemented authorization direction, record the approved Master Spec amendments, and enforce a repository-wide rule that distinguishes real conflicts from expected incomplete work.

**Architecture:** Keep the existing authorization implementation intact and make the documentation hierarchy explicit: Master Spec V4 remains the product baseline, while an additive identity/authorization amendment records approved superseding decisions. Add root agent instructions plus a machine-checkable reconciliation policy so audits must declare delivery context and finding classification before recommending code changes.

**Tech Stack:** Markdown governance/docs, Node.js 22 test runner, existing pnpm `test:scripts`, GitHub Actions, existing Genesis validation.

## Global Constraints

- Do not rewrite historical product intent silently; superseding decisions must be recorded as an explicit dated amendment.
- Keep the implemented granular capability-oriented permission direction; do not rename current permission keys in this reconciliation change.
- Customer signup and customer password recovery initially use six-digit email OTP; SMS OTP is deferred as a replaceable delivery channel.
- Sprint 1B remains a shared identity/session/authorization kernel for platform and tenant administration, not the final auth scope for Customer or Partner actors.
- Dynamic RBAC transition is explicit: Sprint 1B fixed system roles -> Sprint 2 tenant dynamic roles -> Partner scope extension with Partner delivery -> Phase 2 full three-level Role Builder UI.
- Missing work in a later task/sprint is `EXPECTED_INCOMPLETE`, not `CONFLICT` or `MISSING_IMPLEMENTATION`.
- Never mark Plan 1B.4 Task 3 complete without the planned E2E/concurrency evidence.
- All work stays on an isolated feature branch; do not update `main` directly.

---

### Task 1: Add mandatory delivery-reconciliation governance

**Files:**
- Create: `AGENTS.md`
- Create: `docs/governance/DELIVERY-RECONCILIATION.md`
- Create: `scripts/delivery-reconciliation.test.mjs`
- Create: `scripts/delivery-reconciliation.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: repository Markdown files under `docs/superpowers/checkpoints/` whose filename contains `reconciliation`.
- Produces: `pnpm verify:delivery-reconciliation`, exiting non-zero when a reconciliation checkpoint omits required delivery context/classification fields or uses an unsupported classification.

- [ ] **Step 1: Write the failing validator contract**

Create `scripts/delivery-reconciliation.test.mjs` using the Node test runner. Test a valid checkpoint and invalid checkpoints missing `Plan Status`, `Current Task`, `Classification`, `Required Now`, or `Evidence`; also reject an unknown classification.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/delivery-reconciliation.test.mjs`
Expected: FAIL because `scripts/delivery-reconciliation.mjs` does not exist.

- [ ] **Step 3: Implement the minimal validator and command**

Create `scripts/delivery-reconciliation.mjs` with exported validation helpers and a CLI that scans reconciliation checkpoints. Add `verify:delivery-reconciliation` to root `package.json` and include it in `verify:foundation` after `genesis:validate` is not required; the dedicated command is sufficient for this reconciliation branch and can be promoted to required CI in a later CI change.

- [ ] **Step 4: Add root instructions and canonical policy**

`AGENTS.md` must require the classifications `CONFLICT`, `STALE_METADATA`, `ROADMAP_GAP`, `EXPECTED_INCOMPLETE`, and `MISSING_IMPLEMENTATION`, the four checks before declaring conflict, evidence-before-DONE, and a no-scope-jumping rule. `docs/governance/DELIVERY-RECONCILIATION.md` owns the detailed policy and checkpoint format.

- [ ] **Step 5: Verify GREEN**

Run: `node --test scripts/delivery-reconciliation.test.mjs`
Run: `pnpm test:scripts`
Run: `pnpm verify:delivery-reconciliation`
Expected: PASS.

---

### Task 2: Record the approved Master Spec V4 identity/authorization amendment

**Files:**
- Create: `docs/spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`
- Modify: `docs/architecture/BASELINE.md`

**Interfaces:**
- Consumes: Master Spec V4 sections covering RBAC and authentication.
- Produces: one dated superseding source for implemented permission naming philosophy, auth-scope transition, dynamic RBAC transition, and initial Customer email OTP delivery.

- [ ] **Step 1: Document superseding decisions**

The amendment must state that current granular capability/use-case permission keys are the naming direction for implemented capabilities; permission keys remain code-seeded and append-only, while roles and role-permission mappings become dynamic in later delivery. It must explicitly supersede Customer SMS OTP for initial delivery with six-digit email OTP for signup and password recovery, while preserving an adapter-neutral verification challenge so SMS can be added later.

- [ ] **Step 2: Add scope bridges**

Document Sprint 1B as the shared platform/tenant auth kernel, Customer auth as a later actor-specific flow over the same session/security primitives, Partner registration as email verification over the same kernel, and social login as deferred/hidden until scheduled.

- [ ] **Step 3: Add dynamic RBAC transition**

Record Sprint 1B fixed system roles -> Sprint 2 tenant dynamic roles -> Partner-scoped roles with Partner delivery -> Phase 2 three-level Role Builder UI.

- [ ] **Step 4: Make amendment discoverable from architecture baseline**

Add a `Source-of-truth amendments` section to `docs/architecture/BASELINE.md` linking the amendment and saying dated amendments supersede conflicting details in the older Master Spec text without replacing unaffected product requirements.

---

### Task 3: Reconcile Sprint 1B design and Plan 1B.4 execution state

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-identity-membership-authorization-core-design.md`
- Modify: `docs/superpowers/plans/2026-08-05-sprint-1b-04-authorization-hardening.md`
- Create: `docs/superpowers/checkpoints/2026-08-10-sprint-1b-reconciliation.md`

**Interfaces:**
- Consumes: current `main` evidence through commit `81f0a191abdc475ff1ce2c502a45daf78d9352b6` and authorization commits `ac5433df`, `545d7711`, `c9a11c7`.
- Produces: non-stale design metadata, explicit baseline-vs-current-state wording, and a plan progress header that prevents agents from repeating completed work.

- [ ] **Step 1: Reconcile design lifecycle metadata**

Change design status to `Approved design — implementation in progress`. Rename historical `Current State` to `Baseline State at Design Approval — 2026-08-05`. Add an `Implementation Status — reconciled 2026-08-10` section.

- [ ] **Step 2: Add design bridges and amendment link**

Link the Master Spec amendment; state that the old Sprint 1B permission examples are historical design inputs where they conflict with the amendment/current catalog; state the auth-kernel and dynamic-RBAC transition explicitly.

- [ ] **Step 3: Reconcile Plan 1B.4 status**

Add a progress header: `Status: IN_PROGRESS`, `Current Task: Task 3`, `Last reconciled with main: 81f0a191...`; record Task 1 implemented at `ac5433df`, Task 2 implemented at `545d7711`, and Task 3 in progress with `c9a11c7`. Do not mark Task 3 complete and do not mark Tasks 4-8 missing implementation.

- [ ] **Step 4: Add reconciliation checkpoint**

Create a checkpoint using the governance-required fields. Classify stale plan/design metadata as `STALE_METADATA`, the dynamic-RBAC/auth-scope transitions as `ROADMAP_GAP`, Task 4-8 absence as `EXPECTED_INCOMPLETE`, and the permission/source divergence as resolved by the dated amendment rather than leaving two active conflicting sources.

- [ ] **Step 5: Run reconciliation validator**

Run: `pnpm verify:delivery-reconciliation`
Expected: PASS.

---

### Task 4: Reconcile the 90-day roadmap with the approved transitions

**Files:**
- Modify: `docs/plan/90-DAY-EXECUTION.md`

**Interfaces:**
- Consumes: the dated Master Spec amendment and Sprint 1B reconciliation checkpoint.
- Produces: a roadmap that no longer implies Sprint 1B alone completes full dynamic RBAC or all actor authentication.

- [ ] **Step 1: Clarify Sprint 1-2 identity/RBAC scope**

State that Sprint 1B establishes fixed-system-role authorization kernel and Sprint 2 adds tenant-scoped dynamic RBAC over the code-seeded Permission Catalog V2.

- [ ] **Step 2: Place actor-specific auth transitions**

State Customer email-OTP signup/password recovery is delivered with the storefront/customer slice, Partner email verification and partner authorization scope with Partner onboarding, and social login remains deferred/hidden until explicitly scheduled.

- [ ] **Step 3: Verify documentation consistency**

Run: `pnpm genesis:validate`
Run: `pnpm verify:delivery-reconciliation`
Run: `pnpm test:scripts`
Expected: PASS.

---

## Completion Gate

- [ ] Root `AGENTS.md` prevents conflict misclassification and scope jumping.
- [ ] Delivery reconciliation policy and validator exist and pass their tests.
- [ ] Master Spec amendment records Permission Catalog V2 direction, email OTP decision, auth-scope bridge, and dynamic RBAC bridge.
- [ ] Sprint 1B design metadata/current-state language is no longer stale.
- [ ] Plan 1B.4 reports Task 1-2 implemented, Task 3 in progress, and Tasks 4-8 pending without misclassifying them as conflicts.
- [ ] 90-day roadmap explicitly connects Sprint 1B to tenant dynamic RBAC and later Customer/Partner auth delivery.
- [ ] Reconciliation checkpoint passes the machine-checkable policy.
- [ ] Fresh branch verification evidence is recorded before any completion claim.
