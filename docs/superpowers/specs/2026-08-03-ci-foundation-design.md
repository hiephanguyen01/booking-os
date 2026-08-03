# CI Foundation Design

## Status

Approved design; pending written-spec review.

## Context

The repository currently has a dedicated `Knowledge CI` workflow that runs `python tools/genesis_cli.py validate`. The root workspace already exposes the commands required for code quality, type checking, tests, builds, Docker Compose validation, and dependency auditing.

Sprint 0 requires a unified CI foundation covering format, lint, typecheck, unit tests, dependency and secret scanning, build verification, knowledge validation, and Docker Compose configuration validation.

The repository is private and GitHub Advanced Security is not assumed to be enabled. Therefore, Dependency Review is outside this design.

## Goals

- Run CI for every pull request and every push to `main`.
- Provide independent, parallel feedback for quality, tests, builds, security, knowledge validation, and Docker Compose configuration.
- Block merges when dependency advisories are `high` or `critical`.
- Detect committed secrets without granting write permissions or requiring repository secrets.
- Consolidate the existing knowledge workflow into one primary CI workflow.
- Keep the workflow understandable and easy to run locally.

## Non-goals

- CodeQL.
- Docker image build or publication.
- Deployment.
- Coverage thresholds.
- Node.js version matrices.
- Reusable workflows or composite setup actions.
- Branch protection configuration.
- Build artifact publication.
- Dependency Review Action.

## Workflow structure

Create:

```text
.github/workflows/ci.yml
```

Remove:

```text
.github/workflows/knowledge-ci.yml
```

The workflow triggers on:

```yaml
on:
  pull_request:
  push:
    branches:
      - main
```

Use concurrency scoped to the workflow and current ref so a newer run cancels an older run for the same pull request or branch.

Use workflow-level minimum permissions:

```yaml
permissions:
  contents: read
```

Do not use `pull_request_target`, write permissions, or repository secrets.

## Runtime and dependency setup

All Node.js jobs use:

- Ubuntu GitHub-hosted runners.
- Node.js 22.
- pnpm 10.34.5, matching the root `packageManager` field.
- pnpm store caching through `actions/setup-node`.
- `pnpm install --frozen-lockfile`.

Setup steps may be repeated across jobs. A shared composite action or reusable workflow is intentionally deferred until repetition creates a real maintenance cost.

## Jobs

The workflow contains six independent jobs. No job depends on another job.

### `quality`

Purpose: validate formatting, lint rules, and TypeScript correctness.

Commands:

```bash
pnpm check:ci
pnpm lint
pnpm typecheck
```

### `test`

Purpose: run the repository unit-test suite.

Command:

```bash
pnpm test
```

End-to-end tests are not added to this commit because the current CI foundation does not start the complete runtime stack.

### `build`

Purpose: prove all buildable workspace packages compile successfully.

Command:

```bash
pnpm build
```

No build artifacts are uploaded.

### `security`

Purpose: gate severe dependency advisories and detect committed secrets.

Dependency command:

```bash
pnpm audit --audit-level high
```

This fails for `high` and `critical` advisories. Lower severities do not block the workflow.

Secret scanning uses:

```text
gitleaks/gitleaks-action@v3
```

The security checkout uses full history:

```yaml
with:
  fetch-depth: 0
```

Gitleaks configuration:

```yaml
env:
  GITLEAKS_ENABLE_COMMENTS: "false"
  GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"
  GITLEAKS_ENABLE_SUMMARY: "true"
```

The job does not use `continue-on-error`. Registry failures and scanner failures remain visible and fail the job.

### `knowledge`

Purpose: preserve the existing knowledge-governance validation.

Setup:

- Python 3.12.

Command:

```bash
python tools/genesis_cli.py validate
```

### `docker-config`

Purpose: validate Compose interpolation and schema without building MinIO or starting services.

Commands:

```bash
cp .env.docker.example .env.docker
pnpm infra:config
```

The copied `.env.docker` remains untracked and exists only for the job workspace.

## Failure handling and timeouts

- Every job defines `timeout-minutes`.
- No validation step uses `continue-on-error`.
- Jobs remain independent so a failure in one category does not prevent other categories from reporting.
- Dependency registry failures fail `security`; they are not silently ignored.
- No job writes comments, commits, artifacts, releases, or repository settings.

## Repository documentation changes

Update `README.md` with:

- The CI checks that run on pull requests and `main`.
- The equivalent local commands.
- The dependency threshold used by the security job.

Update `docs/backlog/SPRINT-0.md` to mark the CI foundation item complete only after the workflow and local verification pass.

## Local verification

Run before considering implementation complete:

```bash
pnpm install --frozen-lockfile
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level high
python tools/genesis_cli.py validate
cp .env.docker.example .env.docker
pnpm infra:config
```

Also inspect the workflow to confirm:

- YAML is valid.
- `knowledge-ci.yml` has been removed.
- `pull_request_target` is absent.
- Workflow permissions are read-only.
- No repository secrets are referenced.
- Triggers are limited to pull requests and pushes to `main`.
- Gitleaks comments and artifact uploads are disabled.
- All six jobs have explicit timeouts and no inter-job dependencies.

## Completion criteria

Implementation is complete when these checks pass in GitHub Actions:

```text
quality
test
build
security
knowledge
docker-config
```

The repository documentation must match the final workflow behavior, and the local verification commands must pass on the implementation branch.
