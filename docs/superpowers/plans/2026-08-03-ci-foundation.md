# CI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone knowledge workflow with one read-only GitHub Actions workflow that runs six independent quality, test, build, security, knowledge, and Docker Compose validation jobs.

**Architecture:** A single `.github/workflows/ci.yml` triggers for every pull request and every push to `main`. Each job owns its setup and validation commands so jobs run independently and report failures in parallel; no shared artifacts, reusable workflows, deployment behavior, or write permissions are introduced.

**Tech Stack:** GitHub Actions, Node.js 22, pnpm 10.34.5, Turborepo 2.10.7, Biome 2.5.6, Python 3.12, Docker Compose v2, Gitleaks Action v3.

## Global Constraints

- Trigger only on `pull_request` and pushes to `main`.
- Set workflow permissions to `contents: read`; do not add write permissions.
- Do not use `pull_request_target`.
- Do not reference repository-defined secrets.
- Use Node.js `22` for every Node.js job.
- Use pnpm `10.34.5`, matching the root `packageManager` field.
- Install dependencies with `pnpm install --frozen-lockfile` in every Node.js job.
- Use six independent jobs named `quality`, `test`, `build`, `security`, `knowledge`, and `docker-config`.
- Add `timeout-minutes` to every job.
- Do not use `continue-on-error` for validation steps.
- Dependency auditing must fail for `high` and `critical` advisories through `pnpm audit --audit-level high`.
- Gitleaks must disable pull-request comments and SARIF artifact upload while retaining the job summary.
- Docker validation must run `pnpm infra:config`; it must not build images or start services.
- Do not add CodeQL, Dependency Review, deployment, coverage thresholds, Node.js matrices, reusable workflows, composite actions, or build artifact publication.
- Do not mark delivery complete until all six GitHub Actions jobs pass on a pull request or on `main` after integration.

---

## File Structure

- Create `.github/workflows/ci.yml`: the only primary CI workflow; defines triggers, permissions, concurrency, and six independent jobs.
- Delete `.github/workflows/knowledge-ci.yml`: removes the duplicate standalone Genesis validation workflow.
- Modify `README.md`: documents CI behavior, security threshold, and equivalent local commands; updates the workflow directory description.
- Modify `docs/backlog/SPRINT-0.md`: marks the CI foundation and `genesis validate` integration complete only after local verification passes.

No application source files, package manifests, lockfiles, Docker files, or runtime configuration files should change.

---

### Task 1: Consolidate CI into one six-job workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Delete: `.github/workflows/knowledge-ci.yml`

**Interfaces:**
- Consumes: root scripts `check:ci`, `lint`, `typecheck`, `test`, `build`, and `infra:config`; `tools/genesis_cli.py`; `.env.docker.example`; `pnpm-lock.yaml`.
- Produces: GitHub status checks with job IDs `quality`, `test`, `build`, `security`, `knowledge`, and `docker-config`.

- [ ] **Step 1: Verify the pre-change workflow state**

Run:

```bash
test ! -e .github/workflows/ci.yml
test -f .github/workflows/knowledge-ci.yml
grep -F 'name: Knowledge CI' .github/workflows/knowledge-ci.yml
grep -F 'python tools/genesis_cli.py validate' .github/workflows/knowledge-ci.yml
```

Expected: all commands exit `0`; the unified workflow does not exist and the standalone knowledge workflow still owns Genesis validation.

- [ ] **Step 2: Create the unified workflow exactly as specified**

Create `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    name: Quality
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up pnpm
        uses: pnpm/action-setup@v6
        with:
          version: 10.34.5

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Check formatting and static rules
        run: pnpm check:ci

      - name: Lint workspaces
        run: pnpm lint

      - name: Typecheck workspaces
        run: pnpm typecheck

  test:
    name: Unit tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up pnpm
        uses: pnpm/action-setup@v6
        with:
          version: 10.34.5

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run unit tests
        run: pnpm test

  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up pnpm
        uses: pnpm/action-setup@v6
        with:
          version: 10.34.5

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build workspaces
        run: pnpm build

  security:
    name: Security
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout complete history
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Set up pnpm
        uses: pnpm/action-setup@v6
        with:
          version: 10.34.5

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Audit dependencies
        run: pnpm audit --audit-level high

      - name: Scan committed secrets
        uses: gitleaks/gitleaks-action@v3
        env:
          GITHUB_TOKEN: ${{ github.token }}
          GITLEAKS_ENABLE_COMMENTS: "false"
          GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"
          GITLEAKS_ENABLE_SUMMARY: "true"

  knowledge:
    name: Knowledge validation
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up Python
        uses: actions/setup-python@v6
        with:
          python-version: "3.12"

      - name: Validate Genesis artifacts
        run: python tools/genesis_cli.py validate

  docker-config:
    name: Docker Compose configuration
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6

      - name: Set up pnpm
        uses: pnpm/action-setup@v6
        with:
          version: 10.34.5

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Create local Compose environment
        run: cp .env.docker.example .env.docker

      - name: Validate Docker Compose configuration
        run: pnpm infra:config
```

- [ ] **Step 3: Remove the duplicate knowledge workflow**

Run:

```bash
git rm .github/workflows/knowledge-ci.yml
```

Expected: Git stages deletion of `.github/workflows/knowledge-ci.yml`; `ci.yml` is the only workflow that executes `python tools/genesis_cli.py validate`.

- [ ] **Step 4: Validate workflow structure and forbidden features**

Run:

```bash
python - <<'PY'
from pathlib import Path

path = Path('.github/workflows/ci.yml')
text = path.read_text(encoding='utf-8')

required = [
    'name: CI',
    'pull_request:',
    'branches:\n      - main',
    'permissions:\n  contents: read',
    'cancel-in-progress: true',
    '  quality:',
    '  test:',
    '  build:',
    '  security:',
    '  knowledge:',
    '  docker-config:',
    'pnpm check:ci',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test',
    'pnpm build',
    'pnpm audit --audit-level high',
    'gitleaks/gitleaks-action@v3',
    'GITLEAKS_ENABLE_COMMENTS: "false"',
    'GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"',
    'GITLEAKS_ENABLE_SUMMARY: "true"',
    'python tools/genesis_cli.py validate',
    'cp .env.docker.example .env.docker',
    'pnpm infra:config',
]

for fragment in required:
    assert fragment in text, f'missing required fragment: {fragment!r}'

for forbidden in [
    'pull_request_target',
    'continue-on-error',
    'permissions:\n  contents: write',
    'pull-requests: write',
    'pnpm infra:build',
    'pnpm infra:up',
    'dependency-review-action',
    'codeql-action',
    'upload-artifact',
]:
    assert forbidden not in text, f'forbidden fragment present: {forbidden!r}'

assert text.count('timeout-minutes:') == 6
assert text.count('pnpm install --frozen-lockfile') == 5
assert not Path('.github/workflows/knowledge-ci.yml').exists()

print('CI workflow structure: PASS')
PY
```

Expected:

```text
CI workflow structure: PASS
```

- [ ] **Step 5: Run focused commands represented by the workflow**

Run:

```bash
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

Expected: every command exits `0`. The audit may print lower-severity advisories, but it must not report an unhandled `high` or `critical` advisory.

- [ ] **Step 6: Review the workflow diff**

Run:

```bash
git diff --check
git diff -- .github/workflows/ci.yml .github/workflows/knowledge-ci.yml
git status --short
```

Expected: no whitespace errors; one new workflow and one deleted workflow; `.env.docker` does not appear because it is ignored.

- [ ] **Step 7: Commit the workflow consolidation**

Run:

```bash
git add .github/workflows/ci.yml .github/workflows/knowledge-ci.yml
git commit -m "ci: add unified validation workflow"
```

Expected: one commit containing only the unified workflow creation and standalone workflow deletion.

---

### Task 2: Document CI behavior and local parity

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the final job names and commands from `.github/workflows/ci.yml`.
- Produces: operator-facing documentation describing what runs in GitHub Actions and how to reproduce checks locally.

- [ ] **Step 1: Verify the README does not yet document unified CI**

Run:

```bash
! grep -F '## Continuous integration' README.md
grep -F -- '- `.github/workflows/`: knowledge CI.' README.md
```

Expected: the CI section is absent and the structure description still names only knowledge CI.

- [ ] **Step 2: Add the CI section before `## Cấu trúc`**

Insert this exact section immediately before `## Cấu trúc`:

```markdown
## Continuous integration

GitHub Actions runs the unified CI workflow for every pull request and every push to `main`.

The workflow reports six independent checks:

- `quality`: formatting, lint, and TypeScript validation.
- `test`: unit tests.
- `build`: workspace production builds.
- `security`: dependency audit and committed-secret scanning.
- `knowledge`: Genesis artifact validation.
- `docker-config`: Docker Compose interpolation and schema validation.

The dependency audit blocks `high` and `critical` advisories. Gitleaks scans committed history without posting pull-request comments or uploading SARIF artifacts.

Run the equivalent checks locally:

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
```

- [ ] **Step 3: Update the repository structure description**

Replace:

```markdown
- `.github/workflows/`: knowledge CI.
```

with:

```markdown
- `.github/workflows/`: unified quality, test, build, security, knowledge, and Docker configuration CI.
```

- [ ] **Step 4: Verify README content matches the workflow**

Run:

```bash
python - <<'PY'
from pathlib import Path

text = Path('README.md').read_text(encoding='utf-8')
required = [
    '## Continuous integration',
    'every pull request and every push to `main`',
    '`quality`:',
    '`test`:',
    '`build`:',
    '`security`:',
    '`knowledge`:',
    '`docker-config`:',
    'blocks `high` and `critical` advisories',
    'pnpm audit --audit-level high',
    'python tools/genesis_cli.py validate',
    'pnpm infra:config',
    'unified quality, test, build, security, knowledge, and Docker configuration CI',
]

for fragment in required:
    assert fragment in text, f'missing README fragment: {fragment!r}'

assert '- `.github/workflows/`: knowledge CI.' not in text
print('README CI documentation: PASS')
PY
```

Expected:

```text
README CI documentation: PASS
```

- [ ] **Step 5: Review and commit the README update**

Run:

```bash
git diff --check
git diff -- README.md
git add README.md
git commit -m "docs(ci): document validation workflow"
```

Expected: one documentation-only commit.

---

### Task 3: Run full local verification and update Sprint 0 status

**Files:**
- Modify: `docs/backlog/SPRINT-0.md`

**Interfaces:**
- Consumes: the workflow and documentation from Tasks 1 and 2.
- Produces: a verified branch and backlog state reflecting completed CI implementation and Genesis integration.

- [ ] **Step 1: Reinstall from the committed lockfile**

Run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit `0` without modifying `pnpm-lock.yaml`.

- [ ] **Step 2: Run all code-quality checks**

Run:

```bash
pnpm check:ci
pnpm lint
pnpm typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run tests and builds**

Run:

```bash
pnpm test
pnpm build
```

Expected: both commands exit `0`; no source or lockfile changes are produced.

- [ ] **Step 4: Run security, knowledge, and Docker configuration checks**

Run:

```bash
pnpm audit --audit-level high
python tools/genesis_cli.py validate
cp .env.docker.example .env.docker
pnpm infra:config
```

Expected: all commands exit `0`; `.env.docker` remains ignored.

- [ ] **Step 5: Mark the two delivered Sprint 0 items complete**

In `docs/backlog/SPRINT-0.md`, replace:

```markdown
- [ ] CI: format, lint, typecheck, unit, secret/dependency scan và build.
```

with:

```markdown
- [x] CI: format, lint, typecheck, unit, secret/dependency scan và build.
```

Also replace:

```markdown
- [ ] Enable `genesis validate` in CI.
```

with:

```markdown
- [x] Enable `genesis validate` in CI.
```

Do not change unrelated backlog items.

- [ ] **Step 6: Verify only the intended backlog items changed**

Run:

```bash
grep -F -- '- [x] CI: format, lint, typecheck, unit, secret/dependency scan và build.' docs/backlog/SPRINT-0.md
grep -F -- '- [x] Enable `genesis validate` in CI.' docs/backlog/SPRINT-0.md
git diff --check
git diff -- docs/backlog/SPRINT-0.md
```

Expected: both completed lines are present and the diff contains no other backlog changes.

- [ ] **Step 7: Commit Sprint 0 status**

Run:

```bash
git add docs/backlog/SPRINT-0.md
git commit -m "docs(backlog): mark CI foundation complete"
```

Expected: one backlog-only commit.

- [ ] **Step 8: Verify the complete implementation branch**

Run:

```bash
git status --short
git log --oneline --decorate -8
git diff main...HEAD --check
git diff --stat main...HEAD
```

Expected: working tree is clean; the branch contains the design, implementation plan, unified workflow, README update, and backlog update.

---

### Task 4: Verify GitHub Actions after integration is initiated

**Files:**
- Verify: `.github/workflows/ci.yml`
- Verify: GitHub Actions run associated with the pull request or resulting `main` commit.

**Interfaces:**
- Consumes: the clean, locally verified branch from Task 3.
- Produces: six successful GitHub status checks proving the workflow executes on GitHub-hosted runners.

- [ ] **Step 1: Push the implementation branch**

Run:

```bash
git push -u origin chore/ci-foundation
```

Expected: the remote branch contains all implementation commits. Because branch pushes are intentionally not a workflow trigger, no CI run is expected from this command alone.

- [ ] **Step 2: Initiate one supported integration path**

For a pull-request path, open a pull request from `chore/ci-foundation` to `main`. This triggers CI through `pull_request`.

For a local fast-forward merge path, merge only after the branch is locally green, then push `main`. This triggers CI through `push.branches: [main]`.

Do not add a temporary branch-push trigger or `workflow_dispatch` solely for verification.

- [ ] **Step 3: Confirm the six GitHub checks complete successfully**

Verify this exact job list:

```text
quality
test
build
security
knowledge
docker-config
```

Expected: all six jobs conclude `success`; none is skipped because of another job failure.

- [ ] **Step 4: Investigate failures without weakening gates**

If a job fails, inspect that job's logs and fix the underlying command or workflow configuration. Do not add `continue-on-error`, relax the audit threshold, grant write permissions, enable repository secrets, remove a required job, or expand triggers to make the run pass.

After a fix, rerun the complete local verification from Task 3 before pushing the correction.

- [ ] **Step 5: Final delivery check**

Confirm:

```bash
git status --short
```

Expected: clean working tree. Delivery is complete only when local verification is green and the six GitHub jobs have passed on a pull request or on `main`.