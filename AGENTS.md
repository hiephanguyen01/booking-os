# Booking OS Agent Instructions

These instructions apply repository-wide and override default agent behavior when working in this repository.

## Mandatory delivery reconciliation

Before reporting or fixing any mismatch between specification, design, plan, code, tests, migrations, or documentation, first determine the active delivery scope and classify the finding.

Every finding MUST use exactly one classification:

- `CONFLICT` — two currently-active sources require incompatible behavior for the same scope and delivery timeframe.
- `STALE_METADATA` — status, current-state prose, checkbox, or progress metadata is outdated while the implementation direction remains coherent.
- `ROADMAP_GAP` — a higher-level source requires a future capability and the current slice intentionally defers it, but no explicit transition/milestone connects the two.
- `EXPECTED_INCOMPLETE` — the capability belongs to a later task, later sprint, deferred scope, or an in-progress plan. Its absence is expected.
- `MISSING_IMPLEMENTATION` — a task, milestone, acceptance gate, or plan is declared complete but required code/tests/migrations/contracts/docs are absent.

### Before declaring `CONFLICT`

Establish all four conditions:

1. both sources are currently authoritative;
2. both refer to the same feature/scope;
3. both refer to the same delivery timeframe;
4. the difference is not explained by an explicit deferment, phased rollout, transitional implementation, or dated superseding decision.

If any condition is false, do not classify the finding as `CONFLICT`.

### Progress rule

A plan with status `PLANNED` or `IN_PROGRESS` is allowed to have unimplemented future tasks.

Missing work from a future task is `EXPECTED_INCOMPLETE`, not `MISSING_IMPLEMENTATION` and not `CONFLICT`.

Only when the corresponding task/milestone is declared complete may absent required work be classified as `MISSING_IMPLEMENTATION`.

### Evidence before DONE

Never infer completion from a checkbox, commit message, or plan prose alone. Verify fresh repository evidence appropriate to the task, including implementation code, tests, migrations, generated contracts, required documentation, and CI/PR evidence where relevant.

### No scope jumping

Do not implement a later task solely because an audit discovered that capability is absent. If a finding is `EXPECTED_INCOMPLETE`, leave it in its assigned task/sprint unless the user explicitly changes delivery order.

### Required audit context

Every reconciliation/audit must state:

- `Plan Status`
- `Current Task`
- `Classification`
- `Required Now`
- `Evidence`

Detailed policy and checkpoint format: `docs/governance/DELIVERY-RECONCILIATION.md`.

Run `pnpm verify:delivery-reconciliation` for reconciliation checkpoints.
