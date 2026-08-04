# Sprint 0 Closeout Delivery Amendment

**Status:** Approved

**Date:** 2026-08-04

**Owner:** `hiephanguyen01`

**Amends:** `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md`

## Context

The approved Sprint 0 closeout design originally placed governance, initial OpenAPI generation, the generated client, waiver handling, and the fail-closed compatibility gate in one pull request.

That sequence contains a bootstrap contradiction. The compatibility job is required to retrieve `packages/contracts/openapi/openapi.json` from the pull request base commit on `main` and fail closed when the baseline is missing. The current `main` branch has no committed OpenAPI document, so the first pull request cannot both create the baseline and compare against a baseline that does not yet exist.

## Decision

Deliver the approved design through two sequential pull requests.

### PR 1 — Sprint 0 Baseline

Branch: `feat/sprint-0-baseline`

PR 1 implements:

- canonical ADR, Feature, and Pattern templates;
- lifecycle-aware Genesis generation and validation;
- domain ownership and frozen deployment-unit names;
- five accepted architecture ADRs;
- explicit NestJS route visibility classification;
- supported-only deterministic OpenAPI generation;
- committed `packages/contracts/openapi/openapi.json`;
- committed generated TypeScript schema and thin fetch client;
- source-compatible integration behind `createApiClient({ baseUrl }).health.get()`;
- generated-artifact zero-diff checks;
- documentation for regeneration and supported API boundaries.

PR 1 does **not** enable `oasdiff`, compatibility waivers, or a base-versus-revision merge gate. It must prove deterministic generation and preserve all Foundation runtime tests.

After PR 1 merges, `main` contains the first supported API baseline.

### PR 2 — OpenAPI Compatibility Gate

Branch: `feat/openapi-compatibility-gate`, created from updated `main` after PR 1 merges.

PR 2 implements:

- pinned `oasdiff` execution;
- breaking-change fixture coverage;
- versioned YAML compatibility waivers;
- schema validation, owner, reason, exact contract hashes, exact finding fingerprints, and expiry checks;
- `WARN` and `ERR` merge blocking;
- fail-closed base contract retrieval from the pull request base commit;
- permanent GitHub Actions compatibility checks;
- final Sprint 0 documentation and backlog closure.

PR 2 may not introduce or modify supported endpoint behavior except fixtures used to prove the gate.

## Integration Order

```text
main
  └─ PR 1: feat/sprint-0-baseline
       └─ merge to main
            └─ create feat/openapi-compatibility-gate from updated main
                 └─ PR 2
                      └─ merge to main
```

PR 2 must not be opened against a base commit that predates the initial committed OpenAPI document.

## Sprint 0 Completion Rule

Sprint 0 is fully closed only after both pull requests merge and their permanent CI runs pass.

PR 1 may mark these backlog items complete:

- adopt ADR template;
- adopt feature template;
- adopt pattern template;
- assign owners for Identity, Tenancy, Catalog, Booking, Payment, and Finance;
- freeze naming of deployment units;
- record architecture baseline in ADRs;
- OpenAPI contract package.

The repository must not claim that breaking compatibility protection is active until PR 2 merges.

## Verification Boundaries

### PR 1 acceptance

- Genesis tests and repository validation pass.
- Supported routes are classified explicitly.
- Internal routes are absent from `openapi.json`.
- OpenAPI and generated TypeScript outputs are byte-identical across repeated runs.
- Generated-artifact drift check fails when artifacts are stale.
- Existing API, RLS, session, outbox, migration, build, and Playwright checks remain green.

### PR 2 acceptance

- Compatible fixture exits `0`.
- Unwaived `WARN` or `ERR` fixture exits `1`.
- Exact active waiver passes only for its declared contract hashes and fingerprints.
- Expired, malformed, duplicate-ID, wrong-hash, and out-of-scope waivers fail.
- Missing base contract, missing `oasdiff`, invalid documents, and unparseable output fail closed.
- Pull request CI retrieves the baseline from the actual base SHA and blocks unwaived breaking changes.

## Superseded Planning Assumption

Any implementation plan that combines initial contract creation and strict base-contract comparison in one pull request is superseded by this amendment. The approved architecture, artifact locations, lifecycle rules, supported API scope, generated-client design, and waiver policy remain unchanged.