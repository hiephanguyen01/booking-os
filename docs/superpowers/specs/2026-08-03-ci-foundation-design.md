# CI Foundation Design

## Status

Approved for implementation.

## Context

The repository currently has a dedicated `Knowledge CI` workflow that runs `python tools/genesis_cli.py validate`. The root workspace already exposes the commands required for code quality, type checking, tests, builds, Docker Compose validation, and dependency auditing.

Sprint 0 requires a unified CI foundation covering format, lint, typecheck, unit tests, dependency and secret scanning, build verification, knowledge validation, and Docker Compose configuration validation.

The repository is private and GitHub Advanced Security is not assumed to be enabled. Therefore, Dependency Review is outside this design.

## Goals

- Run CI for every pull request and every push to `main`.
- Provide independent, parallel feedback for quality, tests, builds, security, knowledge validation, and Docker Compose configuration.
- Block merges when dependency advisories are `high` or `critical`.
- Detect committed secrets without granting write permissions or requiring repository-defined secrets.
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

Create `.github/workflows/ci.yml` and remove `.github/workflows/knowledge-ci.yml`.

The workflow triggers on every pull request and every push to `main`:

```yaml
on:
  pull_request:
  push:
    branches:
      - main
```

Use concurrency scoped to the workflow and current pull request or ref so a newer run cancels an older run for the same change.

Use workflow-level minimum permissions:

```yaml
permissions:
  contents: read
```

Do not use `pull_request_target`, write permissions, or repository-defined secrets. The automatically provided `github.token` may be passed to Gitleaks for GitHub API access while comments and artifact uploads remain disabled.

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

Run:

```bash
pnpm check:ci
pnpm lint
pnpm typecheck
```

### `test`

Run:

```bash
pnpm test
```

End-to-end tests are outside this commit because the workflow does not start the complete runtime stack.

### `build`

Run:

```bash
pnpm build
```

No build artifacts are uploaded.

### `security`

Run dependency auditing with:

```bash
pnpm audit --audit-level high
```

This fails for `high` and `critical` advisories. Lower severities do not block the workflow.

Use the supported Gitleaks action major:

```text
gitleaks/gitleaks-action@v2
```

The security checkout fetches full history:

```yaml
with:
  fetch-depth: 0
```

Configure Gitleaks with:

```yaml
env:
  GITHUB_TOKEN: ${{ github.token }}
  GITLEAKS_ENABLE_COMMENTS: "false"
  GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"
  GITLEAKS_ENABLE_SUMMARY: "true"
```

The repository belongs to a personal account, so a `GITLEAKS_LICENSE` secret is not required. The job does not use `continue-on-error`; registry failures and scanner failures fail the job.

### `knowledge`

Use Python 3.12 and run:

```bash
python tools/genesis_cli.py validate
```

### `docker-config`

Validate Compose interpolation and schema without building images or starting services:

```bash
cp .env.docker.example .env.docker
pnpm infra:config
```

The copied `.env.docker` remains ignored and exists only in the job workspace.

## Failure handling and timeouts

- Every job defines `timeout-minutes`.
- No validation step uses `continue-on-error`.
- Jobs remain independent so one failure does not prevent other categories from reporting.
- Dependency registry failures fail `security`; they are not silently ignored.
- No job writes comments, commits, artifacts, releases, or repository settings.

## Repository documentation changes

Update `README.md` with the six CI checks, equivalent local commands, and the `high`/`critical` dependency threshold.

Update `docs/backlog/SPRINT-0.md` to mark the CI foundation and Genesis CI integration complete only after the workflow and local verification pass.

## Local verification

Run:

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

Also confirm:

- YAML is valid.
- `knowledge-ci.yml` has been removed.
- `pull_request_target` is absent.
- Workflow permissions are read-only.
- No repository-defined secrets are referenced.
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
