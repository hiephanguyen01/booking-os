# OpenAPI Compatibility Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect the supported API baseline already merged into `main` with a fail-closed `oasdiff` gate and exact, versioned, expiring compatibility waivers.

**Architecture:** Read the base and revision OpenAPI documents as immutable inputs, collect raw single-line `oasdiff` findings, validate every YAML waiver against a strict JSON Schema, select only waivers whose contract hashes and finding fingerprints exactly match the current comparison, and rerun `oasdiff` with temporary anchored ignore files. GitHub Actions materializes the base contract from the pull request base SHA; inability to obtain or compare that baseline fails the job.

**Tech Stack:** Node.js 22, pnpm 10.34.5, TypeScript 5.9.3, JavaScript ESM, `yaml` 2.9.0, Ajv 8.20.0, oasdiff 1.17.0, Node test runner, GitHub Actions, Go 1.24.x.

## Global Constraints

- Implement against `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md` and `docs/superpowers/specs/2026-08-04-sprint-0-closeout-delivery-amendment.md`.
- Create `feat/openapi-compatibility-gate` from updated `main` only after `feat/sprint-0-baseline` has merged and `main` contains `packages/contracts/openapi/openapi.json`.
- Preserve Node.js `>=22.0.0 <25.0.0`, pnpm `>=10.0.0 <11.0.0`, pnpm `10.34.5`, and TypeScript `5.9.3`.
- Pin `yaml@2.9.0` and `ajv@8.20.0` exactly.
- Install and execute `oasdiff@v1.17.0`; local and CI checks use the same version.
- Run `oasdiff breaking --fail-on WARN`; both `ERR` and `WARN` findings block merge unless exactly waived.
- Waivers are YAML data committed under `docs/api/compatibility-waivers/`; they are not labels, environment bypasses, or global ignore switches.
- Every waiver must have a unique ID, assigned owner, substantive reason, future expiry date, exact base/revision SHA-256 hashes, and exact finding fingerprints.
- A waiver may suppress only findings present in the raw report for the exact contract pair.
- Missing baseline, invalid document, invalid waiver, duplicate waiver ID, missing tool, unexpected tool exit, or unparseable output fails closed.
- Do not modify supported endpoint behavior, generated client behavior, database schema, RLS, sessions, inbox/outbox, payments, or queues.
- Do not add a bootstrap exception for missing base contracts.
- Follow TDD: failing fixture test, observed failure, minimal implementation, focused pass, then commit.

## Planned File Structure

```text
schemas/openapi-compatibility-waiver.schema.json
docs/api/compatibility-waivers/README.md
scripts/openapi/check-breaking.mjs
scripts/openapi/check-breaking.test.mjs
scripts/openapi/fixtures/compatible-{base,revision}.json
scripts/openapi/fixtures/breaking-{base,revision}.json
scripts/openapi/fixtures/waivers/{valid,expired,out-of-scope,wrong-hash,invalid}/
.github/workflows/ci.yml
README.md
docs/backlog/SPRINT-0.md
```

---

### Task 1: Define and validate the waiver data model

**Files:**
- Create: `schemas/openapi-compatibility-waiver.schema.json`
- Create: `docs/api/compatibility-waivers/README.md`
- Create: `scripts/openapi/waiver-loader.mjs`
- Create: `scripts/openapi/waiver-loader.test.mjs`
- Create: `scripts/openapi/fixtures/waivers/valid/API-WAIVER-0001.yaml`
- Create: `scripts/openapi/fixtures/waivers/expired/API-WAIVER-0001.yaml`
- Create: `scripts/openapi/fixtures/waivers/wrong-hash/API-WAIVER-0001.yaml`
- Create: `scripts/openapi/fixtures/waivers/invalid/API-WAIVER-0001.yaml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `loadWaivers(directory, options)`, `sha256File(path)`, and normalized `CompatibilityWaiver` objects.

- [ ] **Step 1: Pin parsing and schema dependencies**

```bash
pnpm add -Dw yaml@2.9.0 ajv@8.20.0 --save-exact
```

- [ ] **Step 2: Write the strict JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id",
    "owner",
    "reason",
    "expiresOn",
    "baseContractSha256",
    "revisionContractSha256",
    "findings"
  ],
  "properties": {
    "id": { "type": "string", "pattern": "^API-WAIVER-[0-9]{4}$" },
    "owner": {
      "type": "string",
      "minLength": 1,
      "not": { "enum": ["unassigned", ""] }
    },
    "reason": { "type": "string", "minLength": 20 },
    "expiresOn": { "type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    "baseContractSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "revisionContractSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "findings": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["severity", "fingerprint"],
        "properties": {
          "severity": { "enum": ["ERR", "WARN"] },
          "fingerprint": { "type": "string", "minLength": 1 }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Write failing loader tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { loadWaivers } from "./waiver-loader.mjs";

test("loads one assigned, active, schema-valid waiver", async () => {
  const waivers = await loadWaivers("scripts/openapi/fixtures/waivers/valid", {
    today: "2026-08-04",
  });
  assert.equal(waivers.length, 1);
  assert.equal(waivers[0].id, "API-WAIVER-0001");
});

test("rejects expired, malformed, duplicate, and invalid-date waivers", async () => {
  await assert.rejects(
    loadWaivers("scripts/openapi/fixtures/waivers/expired", { today: "2026-08-04" }),
    /expired on/,
  );
  await assert.rejects(
    loadWaivers("scripts/openapi/fixtures/waivers/invalid", { today: "2026-08-04" }),
    /schema validation failed/,
  );
});
```

Add a temporary fixture containing two files with the same `id` and assert deterministic duplicate-ID failure.

- [ ] **Step 4: Run tests and observe the missing loader**

```bash
node --test scripts/openapi/waiver-loader.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 5: Implement loader and exact date validation**

Parse only direct `*.yaml` files sorted by filename. Compile the repository schema once. After schema validation, parse `expiresOn` as UTC and round-trip it back to `YYYY-MM-DD` so impossible dates such as `2026-02-31` fail. An active waiver requires `expiresOn > today`; expiry on the current date is expired.

```js
export async function loadWaivers(directory, { today }) {
  const currentDate = parseDateOnly(today, "today");
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name)
    .sort();
  const seenIds = new Set();
  const waivers = [];
  for (const filename of files) {
    const document = parse(await readFile(join(directory, filename), "utf8"));
    validateSchema(document, filename);
    if (seenIds.has(document.id)) throw new WaiverError(`duplicate waiver id: ${document.id}`);
    seenIds.add(document.id);
    const expiry = parseDateOnly(document.expiresOn, `${filename}.expiresOn`);
    if (expiry <= currentDate) throw new WaiverError(`${document.id} expired on ${document.expiresOn}`);
    waivers.push(Object.freeze(document));
  }
  return waivers;
}
```

- [ ] **Step 6: Document the canonical waiver format**

```yaml
id: API-WAIVER-0001
owner: hiephanguyen01
reason: Correct the published response contract before Pilot consumers depend on it.
expiresOn: 2026-08-31
baseContractSha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
revisionContractSha256: fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
findings:
  - severity: ERR
    fingerprint: "ERR exact single-line oasdiff finding"
```

Explain expiry, exact hashes, exact fingerprints, removal after migration, and why waiver broadening is forbidden.

- [ ] **Step 7: Verify and commit**

```bash
node --test scripts/openapi/waiver-loader.test.mjs
pnpm check:ci
```

```bash
git add schemas/openapi-compatibility-waiver.schema.json docs/api/compatibility-waivers scripts/openapi/waiver-loader.mjs scripts/openapi/waiver-loader.test.mjs scripts/openapi/fixtures/waivers package.json pnpm-lock.yaml
git commit -m "feat: define exact OpenAPI compatibility waivers"
```

---

### Task 2: Build the fail-closed `oasdiff` compatibility runner

**Files:**
- Create: `scripts/openapi/check-breaking.mjs`
- Create: `scripts/openapi/check-breaking.test.mjs`
- Create: `scripts/openapi/fixtures/compatible-base.json`
- Create: `scripts/openapi/fixtures/compatible-revision.json`
- Create: `scripts/openapi/fixtures/breaking-base.json`
- Create: `scripts/openapi/fixtures/breaking-revision.json`
- Create: `scripts/openapi/fixtures/waivers/out-of-scope/API-WAIVER-0001.yaml`
- Modify: `package.json`

**Interfaces:**
- Consumes: `BASE`, `REVISION`, optional waiver directory, `OASDIFF_BIN`, and `OPENAPI_WAIVER_TODAY`.
- Produces: process exit `0` for compatible or fully waived comparisons, `1` for unwaived breaks, and `2` for configuration/tool/schema/IO failures.

- [ ] **Step 1: Create minimal compatible and breaking OpenAPI fixtures**

The compatible revision adds an optional response field. The breaking revision removes a `200` response or required response property so `oasdiff breaking --fail-on WARN` reports at least one finding.

- [ ] **Step 2: Write a fake `oasdiff` executable for deterministic unit tests**

The fake accepts:

```text
breaking -f singleline BASE REVISION
breaking --fail-on WARN --err-ignore ERR_FILE --warn-ignore WARN_FILE BASE REVISION
```

It emits stable lines prefixed with `ERR` or `WARN`, applies anchored ignore patterns, and returns the same exit classes expected from the real tool.

- [ ] **Step 3: Write failing runner tests**

Cover:

```text
compatible contracts -> 0
breaking without waiver -> 1
valid exact waiver -> 0
expired waiver -> 2
wrong contract hashes -> 1
fingerprint absent from raw report -> 2
missing binary -> 2
unparseable output -> 2
unexpected oasdiff exit -> 2
```

Use child processes with `shell: false`, an injected `OASDIFF_BIN`, and `OPENAPI_WAIVER_TODAY=2026-08-04`.

- [ ] **Step 4: Run tests and observe the missing runner**

```bash
node --test scripts/openapi/check-breaking.test.mjs
```

Expected: module or command failure.

- [ ] **Step 5: Implement exact raw-finding collection**

Algorithm:

```text
1. Validate both contract files as JSON objects with openapi strings beginning with 3.
2. Calculate SHA-256 for both files.
3. Load active schema-valid waivers.
4. Select only waivers whose base and revision hashes equal the current pair.
5. Run oasdiff breaking -f singleline BASE REVISION.
6. Parse every non-empty line as one finding; require severity prefix ERR or WARN.
7. Require every selected waiver fingerprint to be present with matching severity.
8. Escape each fingerprint and write anchored patterns to separate temporary ERR/WARN files.
9. Run oasdiff breaking --fail-on WARN with the two ignore files.
10. Delete temporary files in finally.
```

Use `spawnSync(binary, args, { shell: false, encoding: "utf8" })`. Never interpolate filenames or waiver text into a shell command.

- [ ] **Step 6: Implement stable exit behavior**

```text
0: no findings or all findings exactly waived
1: unwaived WARN/ERR remains
2: invalid usage, invalid contracts, invalid waiver, tool missing, parse failure, unexpected exit, or IO error
```

Print concise stderr messages without dumping environment variables or file contents.

- [ ] **Step 7: Add root command and verify against real oasdiff**

Add:

```json
"api:check-breaking": "node scripts/openapi/check-breaking.mjs"
```

Install and test:

```bash
go install github.com/oasdiff/oasdiff@v1.17.0
export PATH="$(go env GOPATH)/bin:$PATH"
node --test scripts/openapi/check-breaking.test.mjs
pnpm api:check-breaking scripts/openapi/fixtures/compatible-base.json scripts/openapi/fixtures/compatible-revision.json scripts/openapi/fixtures/waivers/valid
```

Assert the compatible command exits `0` and the breaking command without a matching waiver exits `1`.

- [ ] **Step 8: Commit**

```bash
git add scripts/openapi package.json
git commit -m "feat: reject unwaived OpenAPI breaks"
```

---

### Task 3: Prove exact waiver scope with real findings

**Files:**
- Modify: `scripts/openapi/check-breaking.test.mjs`
- Modify: `scripts/openapi/fixtures/waivers/valid/API-WAIVER-0001.yaml`
- Modify: `scripts/openapi/fixtures/waivers/out-of-scope/API-WAIVER-0001.yaml`
- Create: `scripts/openapi/fixtures/waivers/wrong-severity/API-WAIVER-0001.yaml`

**Interfaces:**
- Produces: acceptance fixtures that use actual `oasdiff 1.17.0` single-line findings rather than invented messages.

- [ ] **Step 1: Capture the real single-line report**

```bash
oasdiff breaking -f singleline scripts/openapi/fixtures/breaking-base.json scripts/openapi/fixtures/breaking-revision.json
```

Copy the exact stable output line and severity into the valid fixture. Calculate both file hashes with `sha256sum` and place them in the fixture.

- [ ] **Step 2: Write failing exactness tests**

Assert:

```text
exact severity + fingerprint + hashes -> 0
same fingerprint with changed one-character suffix -> 2 out-of-scope
same fingerprint with wrong severity -> 2
same fingerprint with wrong base or revision hash -> 1 unwaived
```

- [ ] **Step 3: Harden matching and duplicate-finding behavior**

Represent raw findings as `{ severity, fingerprint }`. Reject duplicate waiver entries within one file and reject the same `{severity,fingerprint}` claimed by two active waivers for the same contract pair.

- [ ] **Step 4: Verify and commit**

```bash
node --test scripts/openapi/check-breaking.test.mjs
OPENAPI_WAIVER_TODAY=2026-08-04 pnpm api:check-breaking scripts/openapi/fixtures/breaking-base.json scripts/openapi/fixtures/breaking-revision.json scripts/openapi/fixtures/waivers/valid
```

```bash
git add scripts/openapi/fixtures scripts/openapi/check-breaking.test.mjs
git commit -m "test: prove exact API waiver scope"
```

---

### Task 4: Add the permanent pull-request compatibility gate

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `package.json` only when command help needs a wrapper adjustment

**Interfaces:**
- Produces: a permanent `OpenAPI compatibility` CI job that compares the PR revision with the actual base SHA.

- [ ] **Step 1: Add a CI workflow regression test or parser assertion**

Create a Node test that reads `.github/workflows/ci.yml` and asserts it contains:

```text
fetch-depth: 0
github.event.pull_request.base.sha
git show
packages/contracts/openapi/openapi.json
go install github.com/oasdiff/oasdiff@v1.17.0
pnpm api:check-breaking
```

Run and confirm it fails before workflow changes.

- [ ] **Step 2: Add the compatibility job**

```yaml
api-compatibility:
  name: OpenAPI compatibility
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  timeout-minutes: 15
  steps:
    - name: Checkout complete comparison history
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
    - name: Set up Go
      uses: actions/setup-go@v6
      with:
        go-version: "1.24.x"
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    - name: Install pinned oasdiff
      run: go install github.com/oasdiff/oasdiff@v1.17.0
    - name: Materialize base OpenAPI contract
      env:
        BASE_SHA: ${{ github.event.pull_request.base.sha }}
      run: |
        mkdir -p .tmp/openapi
        git show "${BASE_SHA}:packages/contracts/openapi/openapi.json" > .tmp/openapi/base.json
    - name: Reject unwaived breaking changes
      run: pnpm api:check-breaking .tmp/openapi/base.json packages/contracts/openapi/openapi.json docs/api/compatibility-waivers
```

Do not add `continue-on-error`, fallback contracts, empty baseline generation, or conditional skip after `git show` failure.

- [ ] **Step 3: Keep generation drift independent**

The existing PR 1 generated-artifact job continues to run on pushes and pull requests. Compatibility depends on committed/generated consistency but remains a separate named check so failures are diagnosable.

- [ ] **Step 4: Document local comparison and waiver workflow**

README must include:

```bash
go install github.com/oasdiff/oasdiff@v1.17.0
pnpm api:check-breaking path/to/base.json packages/contracts/openapi/openapi.json docs/api/compatibility-waivers
```

Explain exit codes `0`, `1`, and `2`; how to obtain raw single-line findings; how to calculate hashes; and why each subsequent contract edit invalidates an old waiver hash pair.

- [ ] **Step 5: Run workflow and workspace checks, then commit**

```bash
node --test scripts/openapi/*.test.mjs
pnpm api:check-generated
pnpm genesis:validate
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
```

```bash
git add .github/workflows/ci.yml README.md package.json
git commit -m "ci: enforce OpenAPI compatibility"
```

---

### Task 5: Close Sprint 0 only after gate acceptance evidence

**Files:**
- Modify: `docs/backlog/SPRINT-0.md`
- Modify: `README.md` only for final factual corrections
- Modify: `docs/api/compatibility-waivers/README.md` only for final factual corrections

**Interfaces:**
- Produces: final Sprint 0 completion evidence and a merge-ready PR 2.

- [ ] **Step 1: Verify the compatible path**

```bash
pnpm api:check-breaking \
  scripts/openapi/fixtures/compatible-base.json \
  scripts/openapi/fixtures/compatible-revision.json \
  scripts/openapi/fixtures/waivers/valid
```

Expected: exit `0`.

- [ ] **Step 2: Prove unwaived breaking changes block**

```bash
set +e
pnpm api:check-breaking \
  scripts/openapi/fixtures/breaking-base.json \
  scripts/openapi/fixtures/breaking-revision.json \
  scripts/openapi/fixtures/waivers/out-of-scope
status=$?
set -e
test "$status" -eq 1
```

Expected: at least one unwaived `ERR` or `WARN` is reported and the shell assertion succeeds.

- [ ] **Step 3: Prove exact active waiver success and invalid waiver failure**

```bash
OPENAPI_WAIVER_TODAY=2026-08-04 pnpm api:check-breaking \
  scripts/openapi/fixtures/breaking-base.json \
  scripts/openapi/fixtures/breaking-revision.json \
  scripts/openapi/fixtures/waivers/valid
```

Expected: exit `0`.

Run the expired, wrong-hash, wrong-severity, invalid, and out-of-scope fixture directories and assert each returns the documented non-zero class.

- [ ] **Step 4: Run the complete final-tree verification**

With PostgreSQL and Redis available:

```bash
pnpm install --frozen-lockfile
pnpm api:check-generated
node --test scripts/openapi/*.test.mjs
python -m unittest discover -s tools/tests -p 'test_*.py' -v
pnpm genesis:validate
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm test
pnpm test:e2e:api
pnpm verify:migrations
pnpm build
pnpm test:e2e
pnpm verify:production-config
pnpm audit --audit-level high
cp .env.docker.example .env.docker
pnpm infra:config
```

Every command must exit `0` before completion is claimed.

- [ ] **Step 5: Mark Sprint 0 fully closed**

Update the backlog or closeout note to state that the initial supported baseline exists in `main`, generated drift is enforced, and pull requests now block unwaived `WARN` and `ERR` compatibility changes. Do not add a permanent waiver merely to demonstrate the feature.

- [ ] **Step 6: Review scope and push**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
```

Confirm no supported endpoint behavior change, no migration, no generated-client change except lockfile/script references, no global bypass, and no expired waiver under `docs/api/compatibility-waivers/`.

```bash
git add docs/backlog/SPRINT-0.md README.md docs/api/compatibility-waivers/README.md
git commit -m "docs: close Sprint 0 compatibility governance"
git push -u origin feat/openapi-compatibility-gate
```

Open a PR to `main`. Its body must include compatible, unwaived-breaking, exact-waiver, and invalid-waiver evidence. Wait for `OpenAPI generated artifacts`, `OpenAPI compatibility`, and every existing permanent CI job to pass on the final head SHA before requesting merge.

## Plan Self-Review

- **Spec coverage:** Tasks 1–3 implement strict waiver data, exact contract hashes/fingerprints, expiry, real `oasdiff` findings, and fail-closed exit semantics. Task 4 materializes the contract from the actual PR base SHA and installs the pinned tool in permanent CI. Task 5 proves all acceptance paths and closes Sprint 0 only after the gate is active.
- **Placeholder scan:** No task contains implementation placeholders or permits a broad bypass. Fixture values are generated from exact committed files and real `oasdiff 1.17.0` output during Task 3.
- **Type consistency:** The plan consistently uses `loadWaivers()`, `sha256File()`, `CompatibilityWaiver`, `OASDIFF_BIN`, and `OPENAPI_WAIVER_TODAY`.
- **Scope check:** This plan starts only after PR 1 has merged. It adds compatibility enforcement without changing the supported API baseline or business behavior.