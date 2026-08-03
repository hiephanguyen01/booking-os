# CI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone knowledge workflow with one read-only GitHub Actions workflow that runs six independent quality, test, build, security, knowledge, and Docker Compose validation jobs.

**Architecture:** A single `.github/workflows/ci.yml` triggers for every pull request and every push to `main`. Each job performs its own setup and validation so jobs execute independently and report failures in parallel.

**Tech Stack:** GitHub Actions, Node.js 22, pnpm 10.34.5, Turborepo 2.10.7, Biome 2.5.6, Python 3.12, Docker Compose v2, Gitleaks Action v2.

## Global Constraints

- Trigger only on `pull_request` and pushes to `main`.
- Set workflow permissions to `contents: read`.
- Do not use `pull_request_target`, write permissions, or repository-defined secrets.
- Use Node.js `22` and pnpm `10.34.5` for Node.js jobs.
- Install dependencies with `pnpm install --frozen-lockfile`.
- Use six independent jobs: `quality`, `test`, `build`, `security`, `knowledge`, and `docker-config`.
- Add `timeout-minutes` to every job.
- Do not use `continue-on-error`.
- Fail dependency auditing for `high` and `critical` advisories with `pnpm audit --audit-level high`.
- Use `gitleaks/gitleaks-action@v2` with comments and SARIF artifact upload disabled and summary enabled.
- Fetch complete Git history in the security job.
- Docker validation runs `pnpm infra:config`; it does not build images or start services.
- Do not add CodeQL, Dependency Review, deployments, coverage thresholds, Node matrices, reusable workflows, composite actions, or build artifacts.

---

### Task 1: Consolidate CI workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Delete: `.github/workflows/knowledge-ci.yml`

**Interfaces:**
- Consumes: root scripts `check:ci`, `lint`, `typecheck`, `test`, `build`, and `infra:config`; `tools/genesis_cli.py`; `.env.docker.example`; `pnpm-lock.yaml`.
- Produces: six GitHub status checks named `quality`, `test`, `build`, `security`, `knowledge`, and `docker-config`.

- [ ] **Step 1: Verify the starting state**

```bash
test ! -e .github/workflows/ci.yml
test -f .github/workflows/knowledge-ci.yml
grep -F 'python tools/genesis_cli.py validate' .github/workflows/knowledge-ci.yml
```

Expected: all commands exit `0`.

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

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
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
        with:
          version: 10.34.5
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm check:ci
      - run: pnpm lint
      - run: pnpm typecheck

  test:
    name: Unit tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
        with:
          version: 10.34.5
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
        with:
          version: 10.34.5
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

  security:
    name: Security
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v6
        with:
          version: 10.34.5
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level high
      - uses: gitleaks/gitleaks-action@v2
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
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
      - run: python tools/genesis_cli.py validate

  docker-config:
    name: Docker Compose configuration
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
        with:
          version: 10.34.5
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: cp .env.docker.example .env.docker
      - run: pnpm infra:config
```

- [ ] **Step 3: Delete the duplicate workflow**

```bash
git rm .github/workflows/knowledge-ci.yml
```

Expected: Genesis validation appears only in `ci.yml`.

- [ ] **Step 4: Validate workflow structure**

```bash
python - <<'PY'
from pathlib import Path

text = Path('.github/workflows/ci.yml').read_text(encoding='utf-8')
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
    'gitleaks/gitleaks-action@v2',
    'fetch-depth: 0',
    'GITLEAKS_ENABLE_COMMENTS: "false"',
    'GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"',
    'GITLEAKS_ENABLE_SUMMARY: "true"',
    'python tools/genesis_cli.py validate',
    'cp .env.docker.example .env.docker',
    'pnpm infra:config',
]
for fragment in required:
    assert fragment in text, f'missing: {fragment!r}'
for forbidden in [
    'pull_request_target',
    'continue-on-error',
    'contents: write',
    'pull-requests: write',
    'pnpm infra:build',
    'pnpm infra:up',
    'dependency-review-action',
    'codeql-action',
    'upload-artifact',
    'gitleaks/gitleaks-action@v3',
]:
    assert forbidden not in text, f'forbidden: {forbidden!r}'
assert text.count('timeout-minutes:') == 6
assert text.count('pnpm install --frozen-lockfile') == 5
assert not Path('.github/workflows/knowledge-ci.yml').exists()
print('CI workflow structure: PASS')
PY
```

- [ ] **Step 5: Run workflow-equivalent commands**

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

Expected: all commands exit `0`.

- [ ] **Step 6: Review and commit**

```bash
git diff --check
git diff -- .github/workflows/ci.yml .github/workflows/knowledge-ci.yml
git add .github/workflows/ci.yml .github/workflows/knowledge-ci.yml
git commit -m "ci: add unified validation workflow"
```

---

### Task 2: Document CI behavior

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a `Continuous integration` section before `## Cấu trúc`**

The section must state that CI runs on every pull request and push to `main`; list all six job IDs; explain that dependency auditing blocks `high` and `critical`; explain that Gitleaks scans committed history without comments or SARIF artifacts; and include the complete local command sequence from Task 1 Step 5.

- [ ] **Step 2: Update the workflow directory description**

Replace:

```markdown
- `.github/workflows/`: knowledge CI.
```

with:

```markdown
- `.github/workflows/`: unified quality, test, build, security, knowledge, and Docker configuration CI.
```

- [ ] **Step 3: Validate README content**

```bash
python - <<'PY'
from pathlib import Path
text = Path('README.md').read_text(encoding='utf-8')
for fragment in [
    '## Continuous integration',
    'every pull request and every push to `main`',
    '`quality`', '`test`', '`build`', '`security`', '`knowledge`', '`docker-config`',
    'blocks `high` and `critical` advisories',
    'pnpm audit --audit-level high',
    'python tools/genesis_cli.py validate',
    'pnpm infra:config',
    'unified quality, test, build, security, knowledge, and Docker configuration CI',
]:
    assert fragment in text, f'missing: {fragment!r}'
assert '- `.github/workflows/`: knowledge CI.' not in text
print('README CI documentation: PASS')
PY
```

- [ ] **Step 4: Review and commit**

```bash
git diff --check
git diff -- README.md
git add README.md
git commit -m "docs(ci): document validation workflow"
```

---

### Task 3: Verify locally and update Sprint 0

**Files:**
- Modify: `docs/backlog/SPRINT-0.md`

- [ ] **Step 1: Run the complete local verification**

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

Expected: all commands exit `0` and `pnpm-lock.yaml` remains unchanged.

- [ ] **Step 2: Mark only these backlog items complete**

```markdown
- [x] CI: format, lint, typecheck, unit, secret/dependency scan và build.
- [x] Enable `genesis validate` in CI.
```

- [ ] **Step 3: Verify and commit the backlog update**

```bash
grep -F -- '- [x] CI: format, lint, typecheck, unit, secret/dependency scan và build.' docs/backlog/SPRINT-0.md
grep -F -- '- [x] Enable `genesis validate` in CI.' docs/backlog/SPRINT-0.md
git diff --check
git diff -- docs/backlog/SPRINT-0.md
git add docs/backlog/SPRINT-0.md
git commit -m "docs(backlog): mark CI foundation complete"
```

- [ ] **Step 4: Verify branch state**

```bash
git status --short
git diff main...HEAD --check
git diff --stat main...HEAD
```

Expected: clean working tree containing only the approved CI foundation changes and their design/plan documentation.

---

### Task 4: Verify GitHub Actions

- [ ] **Step 1: Initiate a supported integration path**

Open a pull request from `chore/ci-foundation` to `main`, or fast-forward merge locally and push `main`. Do not add branch-push or manual triggers solely for verification.

- [ ] **Step 2: Confirm all six jobs succeed**

```text
quality
test
build
security
knowledge
docker-config
```

- [ ] **Step 3: Handle failures without weakening gates**

Inspect the failed job and fix the underlying command or workflow configuration. Do not add `continue-on-error`, relax the audit threshold, add write permissions or repository-defined secrets, remove required jobs, or expand triggers to force a pass. Rerun Task 3 local verification after every fix.
