# Sprint 1B Source-of-Truth Reconciliation Checkpoint

Date: 2026-08-10
Plan Status: IN_PROGRESS
Current Task: Task 3
Classification: STALE_METADATA
Required Now: YES
Evidence: The active Sprint 1B.4 plan still shows all task checkboxes unchecked and the Sprint 1B design still says implementation planning is pending, while current `main` at `81f0a191abdc475ff1ce2c502a45daf78d9352b6` contains the Task 1 and Task 2 authorization commits plus Task 3 authorization-session snapshot/version work.

## Reconciliation baseline

- Product baseline: Master Spec V4.0.
- Dated superseding decision: `docs/spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`.
- Active design: `docs/superpowers/specs/2026-08-05-identity-membership-authorization-core-design.md`.
- Active implementation plan: `docs/superpowers/plans/2026-08-05-sprint-1b-04-authorization-hardening.md`.
- Repository evidence baseline: `main` at `81f0a191abdc475ff1ce2c502a45daf78d9352b6`.

## Execution state

| Task | Reconciled state | Evidence | Classification / action |
|---|---|---|---|
| 1 — Authorization Context and Version Reconciliation | Implemented; plan-level closeout evidence should still be read from current repository/CI rather than checkbox alone | `ac5433dfbc272db4eb397269ba23f23926fbdb4b` — `feat: build authoritative authorization context` | `STALE_METADATA` — record implementation state now |
| 2 — Permission Guards and Resource Policies | Implemented; plan-level closeout evidence should still be read from current repository/CI rather than checkbox alone | `545d77111dc40dd9a99209c7b9ce5b5d6ea77184` — `feat: enforce permission and resource policies` | `STALE_METADATA` — record implementation state now |
| 3 — Bind Authorization to Trusted Request and Tenant Execution Context | In progress | `c9a11c7bea153b6f16ea1ab6b738596dbac9740f` adds authorization session snapshots, membership authorization versioning, rejection of attacker identity/role/permission/version headers, and reconciliation/rotation behavior | Continue Task 3. Do **not** mark complete until planned before-use-case/concurrency E2E evidence and the intended Task 3 closeout are verified |
| 4 — Authorization Endpoint and Admin Session Revocation | Pending | Assigned by active plan after Task 3 | `EXPECTED_INCOMPLETE` — Required Now: NO |
| 5 — Browser/Cache/Redirect/Logging/Outbox Hardening | Pending | Assigned by active plan after Task 4 | `EXPECTED_INCOMPLETE` — Required Now: NO |
| 6 — Transactional Audit and Bounded Metrics | Pending | Assigned by active plan after Task 5 | `EXPECTED_INCOMPLETE` — Required Now: NO |
| 7 — Acceptance/Security/RLS/Concurrency/CI Matrix | Pending | Assigned by active plan after Task 6 | `EXPECTED_INCOMPLETE` — Required Now: NO |
| 8 — Feature/Runbook/Rollout/Closeout Docs | Pending | Assigned by active plan after Task 7 | `EXPECTED_INCOMPLETE` — Required Now: NO |

## Finding reconciliation

### F-001 — Design and Plan execution metadata

Finding type: `STALE_METADATA`.

The design status/current-state wording and Plan 1B.4 execution markers lag the current repository. This branch updates lifecycle/progress metadata without pretending that unchecked historical recipe steps are fresh proof of implementation status.

Required action: NOW — reconcile design and plan metadata.

### F-002 — Permission catalog source divergence

Historical state: the original Master Spec examples, the original Sprint 1B design examples, and implemented permission keys use different exact names.

Resolution: `docs/spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md` is the approved dated superseding decision. The implemented granular capability/use-case catalog is the canonical naming baseline for capabilities already shipped. Permission identifiers remain code-seeded and append-only; roles/role-permission mapping become dynamic later.

Current classification after amendment: resolved source-of-truth conflict; no code rename is required in this reconciliation branch.

### F-003 — Dynamic RBAC transition

Finding type: `ROADMAP_GAP`.

Resolution recorded by the amendment and `docs/plan/90-DAY-EXECUTION.md`:

```text
Sprint 1B fixed immutable system roles + Permission Catalog V2
→ Sprint 2 tenant-scoped dynamic RBAC
→ Partner-scoped roles with Partner delivery
→ Phase 2 full three-level Role Builder UI
```

Required action: NOW for documentation; later for implementation according to roadmap.

### F-004 — Product authentication scope

Finding type: `ROADMAP_GAP`.

Resolution recorded by the amendment and roadmap:

- Sprint 1B remains the shared Platform/Tenant identity/session/authorization kernel.
- Customer registration and password recovery initially use six-digit Email OTP and reuse the shared security/session kernel.
- SMS OTP is a deferred replaceable delivery channel.
- Partner registration remains email-link verification and Partner authorization scope arrives with Partner delivery.
- Google/Facebook social login remains deferred and must stay hidden in Pilot UI until implemented.

Required action: NOW for source-of-truth documentation; later implementation stays in its assigned product slices.

### F-005 — Missing Task 4–8 outputs

Finding type: `EXPECTED_INCOMPLETE`.

The absence of `/auth/me/authorization`, final Plan 1B.4 security/audit acceptance matrix, and closeout documentation is expected while Task 3 remains active. Agents must not implement Tasks 4–8 solely to make a reconciliation audit appear clean.

Required action: LATER — continue in plan order unless the user changes priority.

## Governance enforcement

This reconciliation introduced:

- root `AGENTS.md` mandatory finding classifications and no-scope-jumping rule;
- `docs/governance/DELIVERY-RECONCILIATION.md` as the canonical audit/reconciliation policy;
- `scripts/delivery-reconciliation.mjs` and its contract tests;
- `pnpm verify:delivery-reconciliation`, automatically invoked by `pnpm test:scripts`.

Future reconciliation checkpoints with `reconciliation` in the filename must declare `Plan Status`, `Current Task`, `Classification`, `Required Now`, and `Evidence` and use a supported classification.

## Next delivery action

After this reconciliation change is reviewed, resume Sprint 1B.4 at **Task 3**. Do not jump to Task 4 based only on its outputs being absent.
