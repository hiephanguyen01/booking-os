# Delivery Reconciliation Policy

Status: Active
Owner: architecture-governance
Effective: 2026-08-10

## Purpose

This policy prevents agents and reviewers from treating normal delivery sequencing as a specification conflict. It applies whenever Master Spec, design, implementation plans, code, tests, migrations, or operational documentation are compared.

## Source evaluation order

Use the most specific currently-active source for the delivery decision being evaluated:

1. explicit user-approved dated amendments/ADRs;
2. active architecture/design decisions;
3. active implementation plan and its current task;
4. current code/tests/migrations/contracts;
5. historical plans/checkpoints as evidence of prior state.

A dated amendment supersedes only the conflicting details it names. Unaffected Master Spec requirements remain active.

## Required finding classifications

### `CONFLICT`

Use only when two currently-active sources require incompatible behavior for the same scope and timeframe.

Before assigning `CONFLICT`, prove:

- both sources are currently authoritative;
- both address the same feature/scope;
- both address the same delivery timeframe;
- no explicit deferment, phased rollout, transition, or superseding decision explains the difference.

Action: reconcile immediately before extending the affected behavior.

### `STALE_METADATA`

Use when status, checkbox, current-state prose, commit reference, or progress text is outdated while the underlying implementation direction is coherent.

Action: update tracking/documentation. Do not rewrite working implementation merely to match stale metadata.

### `ROADMAP_GAP`

Use when a higher-level source requires a future capability, the current slice intentionally defers it, and the delivery path is not explicit.

Action: add the transition/milestone. Do not pull the future feature into the current task unless delivery order is explicitly changed.

### `EXPECTED_INCOMPLETE`

Use when work belongs to a later task, later sprint, deferred scope, or an active plan that is still `PLANNED`/`IN_PROGRESS`.

Action: keep it tracked in its assigned delivery slice. `Required Now` must normally be `NO`.

Examples:

- Plan 1B.4 Task 4 endpoint absent while Task 3 is still active.
- Partner authorization scope absent while Sprint 1B explicitly supports only platform/tenant scopes.
- Full dynamic role-builder UI absent before the Phase 2 role-builder milestone.

### `MISSING_IMPLEMENTATION`

Use only when a task, milestone, acceptance criterion, or plan is declared complete but required deliverables are absent.

Action: fix before claiming the completed gate remains valid.

## Completion evidence

A checkbox or commit subject is not sufficient evidence by itself. Verify the artifacts required by the plan, such as:

- production implementation;
- focused tests and negative-path tests;
- migrations/schema where relevant;
- generated/public contracts where relevant;
- required docs/runbooks/checkpoints;
- current CI or other execution evidence when a gate is being claimed.

A task may be described as "implemented" before it is "verified complete" when the implementation exists but the plan's full test/closeout evidence has not yet been confirmed.

## No scope jumping

An audit is not authorization to implement future work.

If a finding is `EXPECTED_INCOMPLETE`, agents MUST NOT implement that future task solely to make an audit look clean. Continue the active task first unless the user explicitly changes priority/order.

## Reconciliation checkpoint format

Any Markdown checkpoint whose filename contains `reconciliation` under `docs/superpowers/checkpoints/` is machine-checked.

Each finding block must be represented by a standalone checkpoint document or by the document-level classification when the checkpoint covers one primary finding. The validator currently requires these exact fields:

```text
Plan Status: IN_PROGRESS
Current Task: Task 3
Classification: EXPECTED_INCOMPLETE
Required Now: NO
Evidence: Task 4 remains unchecked and the active implementation is still Task 3.
```

Allowed classifications:

```text
CONFLICT
STALE_METADATA
ROADMAP_GAP
EXPECTED_INCOMPLETE
MISSING_IMPLEMENTATION
```

`Required Now` must be `YES` or `NO`.

Run:

```bash
pnpm verify:delivery-reconciliation
```

## Audit output contract

For every material finding, report:

- active plan/milestone;
- current task;
- finding classification;
- evidence from current sources;
- required action;
- whether the action is required now or later.

This classification must happen before proposing code changes.
