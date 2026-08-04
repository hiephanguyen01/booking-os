# Sprint 0 Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the first supported OpenAPI baseline into `main` together with lifecycle-aware Genesis governance, accepted architecture records, deterministic generated artifacts, and a source-compatible framework-agnostic API client.

**Architecture:** Keep `tools/genesis_cli.py` as the stable Python entry point while extracting artifact definitions, front matter, generation, and validation into focused modules. Mark every NestJS route explicitly as supported or internal, generate a pruned deterministic OpenAPI document without binding a port, derive committed TypeScript types and a thin operation client, then retain HTTP policy and Zod validation in handwritten `@booking-os/api-client` code.

**Tech Stack:** Python 3.12 standard library, Node.js 22, pnpm 10.34.5, TypeScript 5.9.3, NestJS 11.1.28, `@nestjs/swagger` 11.4.6, `openapi-typescript` 7.13.0, Zod 4.4.3, Node test runner, Playwright, GitHub Actions.

## Global Constraints

- Implement against `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md` and `docs/superpowers/specs/2026-08-04-sprint-0-closeout-delivery-amendment.md`.
- Merge the documentation branch first, then create `feat/sprint-0-baseline` from updated `main`.
- Preserve Node.js `>=22.0.0 <25.0.0`, pnpm `>=10.0.0 <11.0.0`, pnpm `10.34.5`, TypeScript `5.9.3`, NestJS `11.1.28`, and Zod `4.4.3`.
- Pin `@nestjs/swagger@11.4.6` and `openapi-typescript@7.13.0` exactly.
- Do not add `oasdiff`, compatibility waivers, or base-versus-revision compatibility checks in this PR.
- Do not add database migrations or alter RLS, session, inbox/outbox, payment, readiness, or queue behavior.
- Do not expose Swagger UI or a raw Swagger HTTP route.
- Only `GET /api/health` and `GET /api/ready` are initially `public-supported`.
- Tenant probes and Foundation diagnostics remain `internal` and absent from the supported contract.
- Every NestJS HTTP route must resolve to exactly one API visibility value.
- Keep `createApiClient({ baseUrl }).health.get()` source-compatible.
- Keep Zod runtime validation for untrusted health responses.
- Commit `packages/contracts/openapi/openapi.json`, `packages/api-client/src/generated/schema.ts`, and `packages/api-client/src/generated/client.ts`.
- Generation must be byte-identical across repeated runs and generated files must carry an overwrite warning.
- Follow TDD for every behavior: write a failing test, observe the failure, implement the minimum, rerun the focused test, then commit.

## Planned File Structure

```text
genesis/templates/{ADR,FEATURE,PATTERN}.md
tools/genesis/{__init__,artifact_types,frontmatter,generator,validator}.py
tools/tests/test_genesis_*.py
docs/ownership/DOMAIN-OWNERS.md
docs/architecture/DEPLOYMENT-UNITS.md
docs/adr/ADR-0002-*.md through ADR-0006-*.md
apps/api/src/api-visibility/*.ts
apps/api/src/openapi/*.ts
scripts/openapi/generate-thin-client.mjs
scripts/openapi/generate-thin-client.test.mjs
scripts/check-generated.mjs
scripts/check-generated.test.mjs
packages/contracts/openapi/openapi.json
packages/api-client/src/generated/{schema,client}.ts
packages/api-client/src/transport.ts
```

---

### Task 1: Build lifecycle-aware Genesis generation and validation

**Files:**
- Create: `genesis/templates/ADR.md`
- Create: `genesis/templates/FEATURE.md`
- Create: `genesis/templates/PATTERN.md`
- Create: `tools/genesis/__init__.py`
- Create: `tools/genesis/artifact_types.py`
- Create: `tools/genesis/frontmatter.py`
- Create: `tools/genesis/generator.py`
- Create: `tools/genesis/validator.py`
- Create: `tools/tests/test_genesis_artifact_types.py`
- Create: `tools/tests/test_genesis_frontmatter.py`
- Create: `tools/tests/test_genesis_generator.py`
- Create: `tools/tests/test_genesis_validator.py`
- Create: `tools/tests/test_genesis_cli.py`
- Modify: `tools/genesis_cli.py`
- Modify: `package.json`

**Interfaces:**
- Produces: `ArtifactKind`, `ArtifactDefinition`, `parse_frontmatter()`, `render_frontmatter()`, `generate_artifact()`, `validate_artifact()`, and `validate_repository()`.
- CLI remains: `validate`, `new-adr`, `new-feature`, and `new-pattern`.

- [ ] **Step 1: Write failing artifact-definition tests**

```python
from pathlib import Path
import unittest

from tools.genesis.artifact_types import ArtifactKind, classify_artifact, definition_for

class ArtifactDefinitionTest(unittest.TestCase):
    def test_definitions_freeze_destinations_ids_and_lifecycles(self) -> None:
        adr = definition_for(ArtifactKind.ADR)
        self.assertEqual(adr.destination, Path("docs/adr"))
        self.assertEqual(adr.prefix, "ADR")
        self.assertEqual(adr.initial_status, "proposed")
        self.assertEqual(adr.completed_statuses, frozenset({"accepted"}))
        self.assertEqual(adr.historical_statuses, frozenset({"superseded", "rejected"}))

        feature = definition_for(ArtifactKind.FEATURE)
        self.assertEqual(feature.destination, Path("docs/features"))
        self.assertEqual(feature.initial_status, "draft")

        pattern = definition_for(ArtifactKind.PATTERN)
        self.assertEqual(pattern.destination, Path("docs/patterns"))
        self.assertEqual(pattern.initial_status, "draft")

    def test_templates_are_not_real_artifacts(self) -> None:
        self.assertIsNone(classify_artifact(Path("genesis/templates/ADR.md")))
        self.assertEqual(
            classify_artifact(Path("docs/adr/ADR-0002-example.md")),
            ArtifactKind.ADR,
        )
```

- [ ] **Step 2: Run the test and confirm the package is missing**

```bash
python -m unittest tools.tests.test_genesis_artifact_types -v
```

Expected: `ModuleNotFoundError: No module named 'tools.genesis'`.

- [ ] **Step 3: Implement artifact definitions**

```python
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

class ArtifactKind(str, Enum):
    ADR = "ADR"
    FEATURE = "FEATURE"
    PATTERN = "PATTERN"

@dataclass(frozen=True)
class ArtifactDefinition:
    kind: ArtifactKind
    prefix: str
    destination: Path
    template: Path
    initial_status: str
    draft_statuses: frozenset[str]
    completed_statuses: frozenset[str]
    historical_statuses: frozenset[str]
    required_sections: tuple[str, ...]
```

Define exact locations and sections from the approved spec. `classify_artifact()` scans only canonical `docs/adr`, `docs/features`, and `docs/patterns` paths.

- [ ] **Step 4: Write failing front-matter, generation, and lifecycle tests**

```python
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.genesis.artifact_types import ArtifactKind
from tools.genesis.generator import GenerationError, generate_artifact
from tools.genesis.validator import validate_repository

class GenesisBehaviorTest(unittest.TestCase):
    def test_generator_allocates_type_local_id_without_overwrite(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "genesis/templates").mkdir(parents=True)
            (root / "docs/adr").mkdir(parents=True)
            (root / "genesis/templates/ADR.md").write_text(
                "---\nid: {{ id }}\ntitle: {{ title }}\nstatus: {{ status }}\nowner: {{ owner }}\ndate: {{ date }}\n---\n\n# {{ title }}\n\n## Context\n\n## Problem\n\n## Options Considered\n\n## Decision\n\n## Trade-offs\n\n## Consequences\n\n## Validation\n\n## References\n",
                encoding="utf-8",
            )
            (root / "docs/adr/ADR-0001-existing.md").write_text("existing", encoding="utf-8")
            path = generate_artifact(root, ArtifactKind.ADR, "Stable Contract", today=date(2026, 8, 4))
            self.assertEqual(path.name, "ADR-0002-stable-contract.md")
            self.assertIn("owner: unassigned", path.read_text(encoding="utf-8"))

    def test_completed_artifact_rejects_placeholder_and_unassigned_owner(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "docs/adr/ADR-0001-complete.md"
            path.parent.mkdir(parents=True)
            path.write_text(
                "---\nid: ADR-0001\ntitle: Complete\nstatus: accepted\nowner: unassigned\ndate: 2026-08-04\n---\n\n# Complete\n\n## Context\n\nTODO\n\n## Problem\n\nProblem.\n\n## Options Considered\n\nA and B.\n\n## Decision\n\nA.\n\n## Trade-offs\n\nTrade-off.\n\n## Consequences\n\nConsequence.\n\n## Validation\n\nTests.\n\n## References\n\nSpec.\n",
                encoding="utf-8",
            )
            messages = [failure.message for failure in validate_repository(root)]
            self.assertIn("accepted artifact owner must be assigned", messages)
            self.assertIn("accepted artifact contains forbidden placeholder: TODO", messages)
```

- [ ] **Step 5: Run the tests and observe missing implementations**

```bash
python -m unittest discover -s tools/tests -p 'test_genesis_*.py' -v
```

Expected: failures for missing front matter, generator, validator, and CLI behavior.

- [ ] **Step 6: Implement strict front matter and atomic generation**

`parse_frontmatter()` must reject missing delimiters, duplicate keys, empty keys, and non-scalar lines. `generate_artifact()` must use a temporary file in the destination directory, flush, `os.fsync()`, `os.replace()`, and remove the temporary file on every exception.

```python
def generate_artifact(root: Path, kind: ArtifactKind, title: str, *, today: date | None = None) -> Path:
    definition = definition_for(kind)
    slug = slugify(title)
    if not slug:
        raise GenerationError("title must contain at least one ASCII letter or digit")
    number = next_numeric_id(root / definition.destination, definition.prefix)
    artifact_id = f"{definition.prefix}-{number:04d}"
    destination = root / definition.destination / f"{artifact_id}-{slug}.md"
    if destination.exists():
        raise GenerationError(f"destination already exists: {destination.relative_to(root)}")
    rendered = render_template(definition, artifact_id, title, today or date.today())
    validate_rendered_draft(rendered, definition, artifact_id)
    atomic_write(destination, rendered)
    return destination
```

- [ ] **Step 7: Implement lifecycle validation**

Require metadata `id`, `title`, `status`, `owner`, and ISO date. Draft states allow empty sections and `unassigned`; completed and historical states require assigned owner, substantive content in every required section, and no `TODO`, `TBD`, `{{ placeholder }}`, or template comments. Report failures in stable path/message order and reject duplicate IDs.

- [ ] **Step 8: Replace CLI internals and test exit contracts**

```python
COMMAND_TO_KIND = {
    "new-adr": ArtifactKind.ADR,
    "new-feature": ArtifactKind.FEATURE,
    "new-pattern": ArtifactKind.PATTERN,
}
```

Contract:

```text
validate: print failures and exit 1; print success and exit 0
new-*: print one repository-relative path and exit 0
invalid input or generation failure: one safe stderr line and exit 2
```

- [ ] **Step 9: Add canonical templates, root alias, and commit**

Add `"genesis:validate": "python tools/genesis_cli.py validate"` to root scripts.

```bash
python -m unittest discover -s tools/tests -p 'test_*.py' -v
python tools/genesis_cli.py validate
```

At this checkpoint the tool tests pass; repository validation may report the existing incomplete ADR, which Task 2 fixes.

```bash
git add genesis/templates tools/genesis tools/genesis_cli.py tools/tests package.json
git commit -m "feat: add lifecycle-aware Genesis artifacts"
```

---

### Task 2: Record ownership, deployment names, and architecture decisions

**Files:**
- Create: `docs/ownership/DOMAIN-OWNERS.md`
- Create: `docs/architecture/DEPLOYMENT-UNITS.md`
- Modify: `docs/adr/ADR-0001-product-before-platform.md`
- Create: `docs/adr/ADR-0002-modular-monolith-deployment-topology.md`
- Create: `docs/adr/ADR-0003-postgresql-rls-tenant-isolation.md`
- Create: `docs/adr/ADR-0004-opaque-bff-sessions-trust-boundary.md`
- Create: `docs/adr/ADR-0005-transactional-inbox-outbox.md`
- Create: `docs/adr/ADR-0006-code-first-openapi-generated-client.md`
- Test: `tools/tests/test_genesis_validator.py`

**Interfaces:**
- Produces: a repository that passes `pnpm genesis:validate` and canonical governance documents used by later work.

- [ ] **Step 1: Add a failing repository ADR regression test**

```python
class RepositoryArtifactRegressionTest(unittest.TestCase):
    def test_repository_architecture_artifacts_are_valid(self) -> None:
        root = Path(__file__).resolve().parents[2]
        failures = [
            failure for failure in validate_repository(root)
            if failure.path.as_posix().startswith("docs/adr/")
        ]
        self.assertEqual(failures, [])
```

Run and confirm ADR-0001 fails required-section validation.

- [ ] **Step 2: Write domain ownership**

Document `hiephanguyen01` as accountable owner and Identity, Tenancy, Catalog, Booking, Payment, and Finance domain-owner roles as `unassigned`. Define accountable owner, domain owner, and contributor/reviewer responsibilities.

- [ ] **Step 3: Freeze deployment identifiers**

Record exactly:

```text
api
web-storefront
web-console
worker-critical
worker-batch
```

State that package names, CI filters, deployment manifests, runbooks, logs, metrics, and dashboards use these identifiers.

- [ ] **Step 4: Complete ADR-0001 and write ADR-0002 through ADR-0006**

Every accepted ADR uses:

```yaml
status: accepted
owner: hiephanguyen01
date: 2026-08-04
```

Each contains Context, Problem, Options Considered, Decision, Trade-offs, Consequences, Validation, and References. Keep one decision per ADR and reference the approved Pilot and closeout specs.

- [ ] **Step 5: Validate and commit**

```bash
python -m unittest tools.tests.test_genesis_validator -v
pnpm genesis:validate
```

Expected: `Knowledge validation passed.`

```bash
git add docs/ownership docs/architecture docs/adr tools/tests/test_genesis_validator.py
git commit -m "docs: record Sprint 0 architecture ownership"
```

---

### Task 3: Classify every NestJS HTTP route

**Files:**
- Create: `apps/api/src/api-visibility/api-visibility.decorator.ts`
- Create: `apps/api/src/api-visibility/api-visibility.resolver.ts`
- Create: `apps/api/src/api-visibility/api-route-inspector.ts`
- Create: `apps/api/src/api-visibility/api-visibility.resolver.test.ts`
- Create: `apps/api/src/api-visibility/api-route-inspector.test.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/tenancy/tenant-probe.controller.ts`

**Interfaces:**
- Produces: `SupportedApi()`, `InternalApi()`, `resolveApiVisibility()`, and `inspectApiRoutes(app)`.

- [ ] **Step 1: Write failing precedence and conflict tests**

```ts
@InternalApi()
class InternalController {
  inherited(): void {}

  @SupportedApi()
  supportedOverride(): void {}
}

assert.equal(
  resolveApiVisibility(InternalController, InternalController.prototype.supportedOverride),
  "public-supported",
);
assert.equal(
  resolveApiVisibility(InternalController, InternalController.prototype.inherited),
  "internal",
);
```

Also assert both markers and no marker throw `exactly one API visibility`.

- [ ] **Step 2: Implement metadata markers and resolver**

```ts
export const SUPPORTED_API_METADATA = Symbol("booking-os:supported-api");
export const INTERNAL_API_METADATA = Symbol("booking-os:internal-api");
export type ApiVisibility = "public-supported" | "internal";
```

Method metadata overrides controller defaults. At the selected level exactly one marker is required.

- [ ] **Step 3: Write the failing real-route inspection test**

Initialize `AppModule`, set the configured global prefix, call `app.init()`, then assert sorted routes include:

```ts
{ method: "GET", path: "/api/health", visibility: "public-supported" }
{ method: "GET", path: "/api/ready", visibility: "public-supported" }
{ method: "GET", path: "/api/foundation/tenant-probes", visibility: "internal" }
```

- [ ] **Step 4: Implement route inspection and annotate controllers**

Use Nest `ModulesContainer`, `MetadataScanner`, `PATH_METADATA`, and `METHOD_METADATA`. Normalize full paths and reject unclassified routes. Add `@SupportedApi()` to `HealthController` and `@InternalApi()` to `TenantProbeController`.

- [ ] **Step 5: Verify runtime behavior and commit**

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
```

```bash
git add apps/api/src/api-visibility apps/api/src/health/health.controller.ts apps/api/src/tenancy/tenant-probe.controller.ts
git commit -m "feat: classify supported and internal API routes"
```

---

### Task 4: Generate the deterministic supported OpenAPI baseline

**Files:**
- Create: `apps/api/src/openapi/health-openapi.dto.ts`
- Create: `apps/api/src/openapi/health-openapi.dto.test.ts`
- Create: `apps/api/src/openapi/openapi-document.ts`
- Create: `apps/api/src/openapi/openapi-document.test.ts`
- Create: `apps/api/src/openapi/generate-openapi.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/contracts/openapi/openapi.json`

**Interfaces:**
- Produces: `createSupportedOpenApiDocument(app)`, stable operation IDs `getHealth` and `getReadiness`, and the first committed baseline.

- [ ] **Step 1: Pin Swagger and write failing metadata tests**

```bash
pnpm --filter @booking-os/api add @nestjs/swagger@11.4.6 --save-exact
```

Assert `SwaggerModule.createDocument()` contains `HealthResponseDto`, `HealthDependencyStatusDto`, and operation IDs `getHealth` and `getReadiness`.

- [ ] **Step 2: Add named documentation DTOs**

```ts
export class HealthDependencyStatusDto {
  @ApiProperty({ enum: HEALTH_STATUSES })
  status!: (typeof HEALTH_STATUSES)[number];
  @ApiPropertyOptional({ minimum: 0 }) latencyMs?: number;
  @ApiPropertyOptional() message?: string;
}

export class HealthResponseDto {
  @ApiProperty() service!: string;
  @ApiProperty({ enum: HEALTH_STATUSES }) status!: (typeof HEALTH_STATUSES)[number];
  @ApiProperty() version!: string;
  @ApiProperty({ format: "date-time" }) timestamp!: string;
  @ApiProperty({ minimum: 0 }) uptimeSeconds!: number;
  @ApiPropertyOptional({ type: "object", additionalProperties: { $ref: getSchemaPath(HealthDependencyStatusDto) } })
  dependencies?: Record<string, HealthDependencyStatusDto>;
}
```

- [ ] **Step 3: Decorate health and readiness without changing handlers**

Use tag `system`, stable operation IDs, `200` response for both routes, and `503` response for readiness. Declare no security requirement because runtime endpoints are unauthenticated.

- [ ] **Step 4: Write failing supported-only and determinism tests**

Assert exact path keys are `/api/health` and `/api/ready`, tenant probe text is absent, operation IDs are unique, every included operation has a tag and a 2xx response, and two generated objects serialize identically.

- [ ] **Step 5: Implement pruning, validation, and recursive normalization**

Prune Swagger operations by the exact supported `{method, path}` set from `inspectApiRoutes(app)`. Sort object keys recursively, sort tags by name, remove `servers` and volatile `x-generated-*` fields, and serialize with two-space indentation plus final newline.

- [ ] **Step 6: Implement a no-listen generator process**

Set safe deterministic environment defaults before dynamically importing `AppModule`, call `NestFactory.create()`, set global prefix, `app.init()`, generate/write the document, and always `app.close()`. Add a child-process test proving the command exits without PostgreSQL/Redis and does not bind the configured port.

- [ ] **Step 7: Generate twice and commit the baseline**

```bash
pnpm --filter @booking-os/api openapi:generate
sha256sum packages/contracts/openapi/openapi.json
pnpm --filter @booking-os/api openapi:generate
sha256sum packages/contracts/openapi/openapi.json
git diff --exit-code -- packages/contracts/openapi/openapi.json
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
pnpm --filter @booking-os/api typecheck
```

```bash
git add apps/api/src/openapi apps/api/src/health/health.controller.ts apps/api/package.json packages/contracts/openapi pnpm-lock.yaml
git commit -m "feat: establish supported OpenAPI baseline"
```

---

### Task 5: Generate the thin client and preserve the existing public API

**Files:**
- Modify: `package.json`
- Modify: `packages/api-client/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/openapi/generate-thin-client.mjs`
- Create: `scripts/openapi/generate-thin-client.test.mjs`
- Create: `scripts/openapi/fixtures/generator-contract.json`
- Create: `packages/api-client/src/generated/schema.ts`
- Create: `packages/api-client/src/generated/client.ts`
- Create: `packages/api-client/src/transport.ts`
- Create: `packages/api-client/tests/transport.test.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`
- Modify: `packages/api-client/tests/client.test.ts`

**Interfaces:**
- Produces: `GeneratedRequest`, `GeneratedRequestOptions`, `GeneratedTransport`, `GeneratedClient`, `createGeneratedClient()`, and `createFetchTransport()`.
- Preserves: `createApiClient(options).health.get()`.

- [ ] **Step 1: Pin `openapi-typescript` and write a failing generator fixture test**

```bash
pnpm add -Dw openapi-typescript@7.13.0 --save-exact
```

Fixture coverage must assert path encoding, query serialization, headers, JSON body, stable operation method names, and response typing through `operations[operationId]`.

- [ ] **Step 2: Implement the fail-closed thin generator**

Emit:

```ts
export interface GeneratedRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface GeneratedRequestOptions {
  readonly signal?: AbortSignal;
}

export type GeneratedTransport = <TResponse>(
  request: GeneratedRequest,
  options?: GeneratedRequestOptions,
) => Promise<TResponse>;
```

Reject duplicate operation IDs, callbacks, multipart bodies, non-JSON bodies, and unsupported parameter serialization rather than emitting misleading code.

- [ ] **Step 3: Generate schema and client with overwrite headers**

Add root `api:generate` that first generates OpenAPI, then runs `openapi-typescript`, then the internal generator. Both TypeScript outputs start with `AUTO-GENERATED. DO NOT EDIT. Run pnpm api:generate.`

- [ ] **Step 4: Write failing fetch transport tests**

Cover base URL normalization, query values, default/caller headers, credentials, optional request ID, timeout, non-2xx HTTP errors, invalid JSON, network cause preservation, and one request per operation with no automatic retry.

- [ ] **Step 5: Implement `createFetchTransport()`**

```ts
export interface FetchTransportOptions {
  readonly baseUrl: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly credentials?: RequestCredentials;
  readonly requestId?: string | (() => string | undefined);
}
```

Use `AbortController`, protected JSON content type, `ApiClientError`, and generic operation-neutral error messages.

- [ ] **Step 6: Refactor `createApiClient()` behind generated operations**

Call `createGeneratedClient(createFetchTransport(options))`; keep `ApiClient.health.get()` and run the existing Zod `healthResponseSchema.safeParse()` before returning `HealthResponse`.

- [ ] **Step 7: Generate twice, test, and commit**

```bash
pnpm api:generate
sha256sum packages/api-client/src/generated/schema.ts packages/api-client/src/generated/client.ts
pnpm api:generate
sha256sum packages/api-client/src/generated/schema.ts packages/api-client/src/generated/client.ts
git diff --exit-code -- packages/contracts/openapi/openapi.json packages/api-client/src/generated
node --test scripts/openapi/generate-thin-client.test.mjs
pnpm --filter @booking-os/api-client test
pnpm --filter @booking-os/api-client typecheck
pnpm test
pnpm typecheck
```

```bash
git add package.json packages/api-client scripts/openapi pnpm-lock.yaml packages/contracts/openapi
git commit -m "feat: generate typed API client baseline"
```

---

### Task 6: Enforce generated-artifact drift in CI

**Files:**
- Create: `scripts/check-generated.mjs`
- Create: `scripts/check-generated.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `turbo.json` when output declarations are required

**Interfaces:**
- Produces: `pnpm api:check-generated` and a permanent `OpenAPI generated artifacts` CI job.

- [ ] **Step 1: Write a failing temporary-repository drift test**

Test clean artifacts exit `0`, stale or missing generated files exit `1`, unrelated dirty files do not fail the script, and generator failure is propagated.

- [ ] **Step 2: Implement scoped regeneration and diff**

The script runs `pnpm api:generate`, then executes:

```bash
git diff --exit-code -- \
  packages/contracts/openapi/openapi.json \
  packages/api-client/src/generated
```

It must not clean or mutate unrelated files.

- [ ] **Step 3: Add root scripts**

```json
"api:generate": "pnpm --filter @booking-os/api openapi:generate && openapi-typescript packages/contracts/openapi/openapi.json --output packages/api-client/src/generated/schema.ts --immutable && node scripts/openapi/generate-thin-client.mjs packages/contracts/openapi/openapi.json packages/api-client/src/generated/client.ts",
"api:check-generated": "node scripts/check-generated.mjs",
"genesis:validate": "python tools/genesis_cli.py validate"
```

- [ ] **Step 4: Add CI generation and strengthen knowledge validation**

The OpenAPI job checks out the repository, installs pnpm/Node, runs `pnpm api:check-generated`, runs generator tests, and typechecks/tests `@booking-os/api-client`. It does not install or run `oasdiff`.

The knowledge job runs Python unit tests before `python tools/genesis_cli.py validate`.

- [ ] **Step 5: Verify and commit**

```bash
node --test scripts/check-generated.test.mjs
pnpm api:check-generated
python -m unittest discover -s tools/tests -p 'test_*.py' -v
pnpm genesis:validate
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
```

```bash
git add scripts/check-generated.mjs scripts/check-generated.test.mjs package.json .github/workflows/ci.yml turbo.json
git commit -m "ci: enforce deterministic API artifacts"
```

---

### Task 7: Document the baseline and complete PR 1 verification

**Files:**
- Modify: `README.md`
- Modify: `docs/backlog/SPRINT-0.md`
- Modify: `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md` only for factual corrections discovered during implementation

**Interfaces:**
- Produces: accurate local commands and a PR ready to seed the baseline in `main`.

- [ ] **Step 1: Add a failing README command test**

Assert README contains:

```text
pnpm genesis:validate
pnpm api:generate
pnpm api:check-generated
```

Do not require `api:check-breaking` in PR 1 documentation.

- [ ] **Step 2: Document governance and generation**

Explain artifact creation/lifecycle rules, supported/internal API boundaries, contract and generated-client paths, why generated files are committed, no Swagger UI, and stable `health.get()` usage. State clearly that compatibility blocking arrives in PR 2.

- [ ] **Step 3: Mark the approved PR 1 backlog items complete**

Mark templates, ownership, deployment names, architecture ADRs, and OpenAPI contract package complete. Do not claim the compatibility gate is active.

- [ ] **Step 4: Run full final-tree verification**

With PostgreSQL and Redis available:

```bash
pnpm install --frozen-lockfile
pnpm api:check-generated
python -m unittest discover -s tools/tests -p 'test_*.py' -v
node --test scripts/openapi/*.test.mjs
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

- [ ] **Step 5: Review scope and commit**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
```

Confirm no migration, no Partner/Catalog/Booking behavior, no Swagger route, no compatibility bypass, and no direct generated edits.

```bash
git add README.md docs/backlog/SPRINT-0.md
git commit -m "docs: publish Sprint 0 API baseline workflow"
git push -u origin feat/sprint-0-baseline
```

Open a PR to `main`, include verification evidence, and wait for every permanent CI job on the final head SHA before merge.

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 cover all governance and architecture records. Tasks 3–5 cover explicit route classification, deterministic supported OpenAPI, generated types/client, handwritten transport, and source compatibility. Task 6 adds zero-diff enforcement without prematurely enabling compatibility comparison. Task 7 documents the bootstrap boundary and verifies the complete Foundation tree.
- **Placeholder scan:** No implementation step permits `TODO`, `TBD`, ellipses, or unspecified error handling in committed artifacts.
- **Type consistency:** `ApiVisibility`, `inspectApiRoutes()`, `GeneratedRequest`, `GeneratedRequestOptions`, `GeneratedTransport`, `GeneratedClient`, `createGeneratedClient()`, and `createFetchTransport()` use the same names across producer and consumer tasks.
- **Scope check:** This plan ends when the first contract baseline is merged into `main`. It intentionally excludes all waiver and `oasdiff` work, which belongs to the second plan.