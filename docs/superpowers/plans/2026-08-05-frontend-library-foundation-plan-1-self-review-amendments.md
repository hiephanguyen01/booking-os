# Plan 1 — Mandatory Self-Review Amendments

This file is normative and overrides the two conflicting commands in the task documents. No other requirement is changed.

## Amendment 1: Install Dependencies, Do Not Only Rewrite the Lockfile

In `2026-08-05-frontend-library-foundation-plan-1-task-1-dependencies-tailwind.md`, Task 1.1 Step 5 must run:

```bash
pnpm install
node --test scripts/architecture/frontend-library-boundaries.test.mjs
pnpm verify:frontend-libraries
```

Expected:

- `pnpm-lock.yaml` is updated.
- New packages are present in `node_modules` for subsequent RED/GREEN tasks.
- Both boundary commands exit `0`.

Do not use `pnpm install --lockfile-only` for this checkpoint because subsequent tasks immediately import the newly added dependencies.

## Amendment 2: Scope Diff from the Design-Branch Merge Base

In `2026-08-05-frontend-library-foundation-plan-1-task-4-pages-gates.md`, Task 4.3 Step 4 must run:

```bash
BASE_SHA=$(git merge-base HEAD origin/docs/frontend-library-foundation-design)
git diff --stat "$BASE_SHA"..HEAD
git diff --name-only "$BASE_SHA"..HEAD
```

Expected files remain limited to:

```text
pnpm-workspace.yaml
pnpm-lock.yaml
package.json
apps/web-console/**
packages/api-client/package.json
packages/contracts/**
packages/ui/**
scripts/architecture/frontend-*.mjs
e2e/identity.spec.ts
```

This avoids assuming a fixed number of commits and remains correct when RED and GREEN checkpoints are split or amended during implementation.
