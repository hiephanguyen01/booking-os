# Sprint 0 Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining Sprint 0 governance and API-contract item with lifecycle-aware Genesis artifacts, accepted architecture ADRs, deterministic code-first OpenAPI generation, a committed framework-agnostic TypeScript client, and a fail-closed compatibility gate.

**Architecture:** Keep `tools/genesis_cli.py` as the stable Python entry point while moving parsing, artifact definitions, generation, and validation into focused `tools/genesis/` modules. Generate the supported NestJS contract from explicit route-visibility metadata, normalize it deterministically, derive a runtime-free schema plus a thin generated client, then place all environment and error behavior in the existing handwritten `@booking-os/api-client` wrapper. CI regenerates committed artifacts, compares the PR contract with the base contract through `oasdiff`, and accepts only exact, active, scoped waivers.

**Tech Stack:** Python 3.12 standard library, Node.js 22, pnpm 10.34.5, TypeScript 5.9.3, NestJS 11.1.28, `@nestjs/swagger` 11.4.6, `openapi-typescript` 7.13.0, `yaml` 2.9.0, Ajv 8.20.0, oasdiff 1.17.0, Node test runner, Playwright, GitHub Actions.

## Global Constraints

- Implement against the approved spec at `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md`.
- Create the implementation branch from an updated `main`; do not implement directly on `docs/sprint-0-closeout-design`.
- Preserve Node.js `>=22.0.0 <25.0.0`, pnpm `>=10.0.0 <11.0.0`, pnpm `10.34.5`, and TypeScript `5.9.3`.
- Pin new dependencies exactly: `@nestjs/swagger@11.4.6`, `openapi-typescript@7.13.0`, `yaml@2.9.0`, and `ajv@8.20.0`.
- Install and execute `oasdiff@v1.17.0`; CI must use the same version.
- Do not add database migrations or change RLS, sessions, inbox/outbox, payment, readiness, or queue behavior.
- Do not expose Swagger UI or a raw Swagger HTTP route in any environment.
- Only `GET /api/health` and `GET /api/ready` are initially `public-supported`; tenant probes and Foundation diagnostics remain `internal`.
- Every NestJS HTTP route must resolve to exactly one API visibility value.
- Keep `createApiClient({ baseUrl }).health.get()` source-compatible.
- Zod remains the runtime validator for untrusted health responses.
- Generated files are committed and must begin with an overwrite warning.
- OpenAPI and client generation must be byte-identical across repeated runs.
- Compatibility gating uses `oasdiff breaking --fail-on WARN`; both `ERR` and `WARN` findings block unless exactly waived.
- Waivers are versioned YAML data, not labels, environment flags, or global bypasses.
- No partner, catalog, resource, listing, pricing, availability, or booking behavior belongs in this plan.
- Follow TDD for every behavioral task: failing test, observed failure, minimal implementation, passing focused test, then commit.

## Planned File Structure

```text
genesis/templates/
  ADR.md                         # Canonical ADR source template
  FEATURE.md                     # Canonical feature source template
  PATTERN.md                     # Canonical pattern source template

tools/genesis/
  __init__.py                    # Public Python package marker
  artifact_types.py              # Artifact definitions, lifecycles, locations, IDs
  frontmatter.py                 # YAML-like front matter parsing/rendering
  generator.py                   # Atomic template rendering and ID allocation
  validator.py                   # Lifecycle and repository validation

tools/tests/
  test_genesis_artifact_types.py
  test_genesis_frontmatter.py
  test_genesis_generator.py
  test_genesis_validator.py
  test_genesis_cli.py

docs/ownership/DOMAIN-OWNERS.md  # Accountable and domain ownership model
docs/architecture/DEPLOYMENT-UNITS.md

docs/adr/
  ADR-0001-product-before-platform.md              # Add newly required sections
  ADR-0002-modular-monolith-deployment-topology.md
  ADR-0003-postgresql-rls-tenant-isolation.md
  ADR-0004-opaque-bff-sessions-trust-boundary.md
  ADR-0005-transactional-inbox-outbox.md
  ADR-0006-code-first-openapi-generated-client.md

apps/api/src/api-visibility/
  api-visibility.decorator.ts     # SupportedApi/InternalApi metadata
  api-visibility.resolver.ts      # Controller/method override resolution
  api-route-inspector.ts          # Enumerate and classify Nest HTTP routes
  *.test.ts

apps/api/src/openapi/
  health-openapi.dto.ts           # Named Swagger-only models matching contracts
  openapi-document.ts             # Create, filter, validate, normalize document
  openapi-document.test.ts
  generate-openapi.ts             # Side-effect-controlled file generator entry point

scripts/openapi/
  generate-thin-client.mjs        # Emit generated client from operation IDs
  generate-thin-client.test.mjs
  check-breaking.mjs              # Validate waivers and invoke pinned oasdiff
  check-breaking.test.mjs
  fixtures/                       # Compatible/breaking/waiver test contracts

schemas/
  openapi-compatibility-waiver.schema.json

docs/api/compatibility-waivers/
  README.md

packages/contracts/openapi/
  openapi.json

packages/api-client/src/generated/
  schema.ts
  client.ts

packages/api-client/src/
  transport.ts                    # Handwritten fetch transport
  client.ts                       # Source-compatible adapter and Zod validation

.github/workflows/ci.yml          # Generation and compatibility merge gates
```

---

### Task 1: Build the lifecycle-aware Genesis toolchain

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
- Consumes: Repository root `Path`, canonical artifact directories, and current Markdown artifacts.
- Produces: `ArtifactKind`, `ArtifactDefinition`, `parse_frontmatter()`, `render_frontmatter()`, `generate_artifact()`, `validate_artifact()`, `validate_repository()`, and stable CLI commands used by CI and later tasks.

- [ ] **Step 1: Write failing artifact-definition and front-matter tests**

```python
# tools/tests/test_genesis_artifact_types.py
from pathlib import Path
import unittest

from tools.genesis.artifact_types import ArtifactKind, definition_for, classify_artifact

class ArtifactDefinitionTest(unittest.TestCase):
    def test_definitions_freeze_locations_prefixes_and_lifecycles(self) -> None:
        adr = definition_for(ArtifactKind.ADR)
        self.assertEqual(adr.destination, Path("docs/adr"))
        self.assertEqual(adr.prefix, "ADR")
        self.assertEqual(adr.initial_status, "proposed")
        self.assertEqual(adr.completed_statuses, frozenset({"accepted"}))
        self.assertEqual(adr.historical_statuses, frozenset({"superseded", "rejected"}))

        feature = definition_for(ArtifactKind.FEATURE)
        self.assertEqual(feature.destination, Path("docs/features"))
        self.assertEqual(feature.prefix, "FEATURE")
        self.assertEqual(feature.initial_status, "draft")

        pattern = definition_for(ArtifactKind.PATTERN)
        self.assertEqual(pattern.destination, Path("docs/patterns"))
        self.assertEqual(pattern.prefix, "PATTERN")
        self.assertEqual(pattern.initial_status, "draft")

    def test_templates_are_not_classified_as_repository_artifacts(self) -> None:
        self.assertIsNone(classify_artifact(Path("genesis/templates/ADR.md")))
        self.assertEqual(
            classify_artifact(Path("docs/adr/ADR-0002-example.md")),
            ArtifactKind.ADR,
        )
```

```python
# tools/tests/test_genesis_frontmatter.py
import unittest

from tools.genesis.frontmatter import FrontmatterError, parse_frontmatter, render_frontmatter

class FrontmatterTest(unittest.TestCase):
    def test_round_trips_ordered_scalar_metadata(self) -> None:
        source = "---\nid: ADR-0002\ntitle: Example\nstatus: accepted\nowner: owner\ndate: 2026-08-04\n---\n\n# Example\n"
        parsed = parse_frontmatter(source)
        self.assertEqual(parsed.metadata["id"], "ADR-0002")
        self.assertEqual(parsed.body, "# Example\n")
        self.assertEqual(render_frontmatter(parsed.metadata, parsed.body), source)

    def test_rejects_missing_or_duplicate_frontmatter_keys(self) -> None:
        with self.assertRaises(FrontmatterError):
            parse_frontmatter("# No metadata\n")
        with self.assertRaises(FrontmatterError):
            parse_frontmatter("---\nid: A\nid: B\n---\n\nBody\n")
```

- [ ] **Step 2: Run the focused tests and confirm imports fail**

Run:

```bash
python -m unittest \
  tools.tests.test_genesis_artifact_types \
  tools.tests.test_genesis_frontmatter -v
```

Expected: `ModuleNotFoundError: No module named 'tools.genesis'`.

- [ ] **Step 3: Implement artifact definitions and strict front-matter parsing**

```python
# tools/genesis/artifact_types.py
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

DEFINITIONS = {
    ArtifactKind.ADR: ArtifactDefinition(
        kind=ArtifactKind.ADR,
        prefix="ADR",
        destination=Path("docs/adr"),
        template=Path("genesis/templates/ADR.md"),
        initial_status="proposed",
        draft_statuses=frozenset({"proposed"}),
        completed_statuses=frozenset({"accepted"}),
        historical_statuses=frozenset({"superseded", "rejected"}),
        required_sections=(
            "Context", "Problem", "Options Considered", "Decision",
            "Trade-offs", "Consequences", "Validation", "References",
        ),
    ),
    ArtifactKind.FEATURE: ArtifactDefinition(
        kind=ArtifactKind.FEATURE,
        prefix="FEATURE",
        destination=Path("docs/features"),
        template=Path("genesis/templates/FEATURE.md"),
        initial_status="draft",
        draft_statuses=frozenset({"draft"}),
        completed_statuses=frozenset({"active"}),
        historical_statuses=frozenset({"deprecated"}),
        required_sections=(
            "Problem", "Goal", "Non-goals", "Business Rules",
            "Acceptance Criteria", "Test Plan",
        ),
    ),
    ArtifactKind.PATTERN: ArtifactDefinition(
        kind=ArtifactKind.PATTERN,
        prefix="PATTERN",
        destination=Path("docs/patterns"),
        template=Path("genesis/templates/PATTERN.md"),
        initial_status="draft",
        draft_statuses=frozenset({"draft"}),
        completed_statuses=frozenset({"active"}),
        historical_statuses=frozenset({"deprecated"}),
        required_sections=("Problem", "Context", "Solution", "Trade-offs", "Review Checklist"),
    ),
}

def definition_for(kind: ArtifactKind) -> ArtifactDefinition:
    return DEFINITIONS[kind]

def classify_artifact(path: Path) -> ArtifactKind | None:
    normalized = path.as_posix()
    for kind, definition in DEFINITIONS.items():
        prefix = f"{definition.destination.as_posix()}/{definition.prefix}-"
        if normalized.startswith(prefix) and path.suffix == ".md":
            return kind
    return None
```

Implement `tools/genesis/frontmatter.py` with a `ParsedDocument` dataclass, duplicate-key rejection, exactly one opening and closing `---`, scalar `key: value` parsing, stable key order, and a final newline.

- [ ] **Step 4: Write failing generator and validator tests**

```python
# tools/tests/test_genesis_generator.py
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.genesis.artifact_types import ArtifactKind
from tools.genesis.generator import GenerationError, generate_artifact

class GeneratorTest(unittest.TestCase):
    def test_allocates_type_local_id_and_renders_canonical_template(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "genesis/templates").mkdir(parents=True)
            (root / "docs/adr").mkdir(parents=True)
            (root / "genesis/templates/ADR.md").write_text(
                "---\nid: {{ id }}\ntitle: {{ title }}\nstatus: {{ status }}\nowner: {{ owner }}\ndate: {{ date }}\n---\n\n# {{ title }}\n\n## Context\n\n## Problem\n\n## Options Considered\n\n## Decision\n\n## Trade-offs\n\n## Consequences\n\n## Validation\n\n## References\n",
                encoding="utf-8",
            )
            (root / "docs/adr/ADR-0001-existing.md").write_text("existing", encoding="utf-8")

            path = generate_artifact(root, ArtifactKind.ADR, "Stable API Contract", today=date(2026, 8, 4))

            self.assertEqual(path.relative_to(root), Path("docs/adr/ADR-0002-stable-api-contract.md"))
            text = path.read_text(encoding="utf-8")
            self.assertIn("id: ADR-0002", text)
            self.assertIn("status: proposed", text)
            self.assertIn("owner: unassigned", text)

    def test_refuses_empty_slug_and_existing_destination_without_partial_file(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(GenerationError):
                generate_artifact(root, ArtifactKind.ADR, "---", today=date(2026, 8, 4))
            self.assertEqual(list(root.rglob("*.tmp")), [])
```

```python
# tools/tests/test_genesis_validator.py
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.genesis.validator import validate_repository

ACCEPTED_ADR = """---
id: ADR-0001
title: Complete
status: accepted
owner: owner
date: 2026-08-04
---

# Complete

## Context

Real context.

## Problem

Real problem.

## Options Considered

Option A and option B.

## Decision

Choose A.

## Trade-offs

Documented trade-off.

## Consequences

Documented consequence.

## Validation

Tests and review.

## References

Approved design.
"""

class ValidatorTest(unittest.TestCase):
    def test_accepts_complete_artifact_and_rejects_completed_placeholders(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "docs/adr/ADR-0001-complete.md"
            path.parent.mkdir(parents=True)
            path.write_text(ACCEPTED_ADR, encoding="utf-8")
            self.assertEqual(validate_repository(root), [])

            path.write_text(ACCEPTED_ADR.replace("Real context.", "TODO"), encoding="utf-8")
            messages = [failure.message for failure in validate_repository(root)]
            self.assertIn("accepted artifact contains forbidden placeholder: TODO", messages)

    def test_allows_empty_draft_sections_and_unassigned_owner(self) -> None:
        # Build a complete set of headings with proposed/unassigned metadata.
        # Assert validation succeeds because lifecycle rules allow unfinished draft content.
        ...

    def test_rejects_duplicate_ids_invalid_status_and_missing_completed_content(self) -> None:
        # Create two ADR files with ADR-0001, one with status active, and one empty accepted section.
        # Assert each exact error is reported in stable path order.
        ...
```

Replace the ellipses while writing the test with concrete temporary-file setup; do not leave them in the committed test.

- [ ] **Step 5: Run generator/validator tests and observe missing implementations**

Run:

```bash
python -m unittest \
  tools.tests.test_genesis_generator \
  tools.tests.test_genesis_validator -v
```

Expected: import failures for `tools.genesis.generator` and `tools.genesis.validator`.

- [ ] **Step 6: Add canonical templates and implement atomic generation**

Each template must contain exactly these placeholders:

```text
{{ id }}
{{ title }}
{{ status }}
{{ owner }}
{{ date }}
```

`generate_artifact()` must:

```python
def generate_artifact(
    root: Path,
    kind: ArtifactKind,
    title: str,
    *,
    today: date | None = None,
) -> Path:
    definition = definition_for(kind)
    slug = slugify(title)
    if not slug:
        raise GenerationError("title must contain at least one ASCII letter or digit")
    number = next_numeric_id(root / definition.destination, definition.prefix)
    artifact_id = f"{definition.prefix}-{number:04d}"
    destination = root / definition.destination / f"{artifact_id}-{slug}.md"
    if destination.exists():
        raise GenerationError(f"destination already exists: {destination.relative_to(root)}")
    rendered = render_template(...)
    validate_rendered_draft(rendered, definition, artifact_id)
    atomic_write(destination, rendered)
    return destination
```

Use `tempfile.NamedTemporaryFile(dir=destination.parent, delete=False)`, flush, `os.fsync()`, and `os.replace()`; delete the temporary file on every exception.

- [ ] **Step 7: Implement lifecycle and repository validation**

`validate_artifact()` must enforce:

```python
FORBIDDEN_PLACEHOLDERS = (
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bTBD\b", re.IGNORECASE),
    re.compile(r"\{\{[^}]+\}\}"),
    re.compile(r"<!--\s*template", re.IGNORECASE),
)
```

A completed section is substantive when its content contains at least one Unicode letter or digit after removing HTML comments and whitespace. Validate IDs with `^{PREFIX}-\d{4}$`, validate status against the artifact definition, require metadata `id`, `title`, `status`, `owner`, and `date`, validate `date` with `date.fromisoformat()`, and report failures sorted by repository-relative path then message.

`validate_repository(root)` must scan only canonical artifact directories, validate templates separately, and perform a repository-wide duplicate-ID pass.

- [ ] **Step 8: Replace the CLI internals and add command tests**

```python
# tools/genesis_cli.py
from tools.genesis.artifact_types import ArtifactKind
from tools.genesis.generator import GenerationError, generate_artifact
from tools.genesis.validator import validate_repository

COMMAND_TO_KIND = {
    "new-adr": ArtifactKind.ADR,
    "new-feature": ArtifactKind.FEATURE,
    "new-pattern": ArtifactKind.PATTERN,
}
```

The CLI contract is:

```text
validate      -> print all failures; exit 1 when any exist
new-*         -> print one repository-relative path; exit 0
invalid input -> print a safe one-line error to stderr; exit 2
```

Use `subprocess.run([sys.executable, "tools/genesis_cli.py", ...], cwd=root, text=True, capture_output=True)` in `test_genesis_cli.py` to verify all four commands and exit codes.

- [ ] **Step 9: Run all Python tests and Genesis validation**

Run:

```bash
python -m unittest discover -s tools/tests -p 'test_*.py' -v
python tools/genesis_cli.py validate
```

Expected now: unit tests pass; repository validation may still report only the known incomplete existing ADR until Task 2 updates it. Record the exact failure and do not weaken the validator.

- [ ] **Step 10: Add the stable root script and commit**

Add:

```json
"genesis:validate": "python tools/genesis_cli.py validate"
```

Run `pnpm genesis:validate` and confirm it reports the same known ADR gap, then commit the toolchain without marking the Sprint 0 backlog complete:

```bash
git add genesis/templates tools/genesis tools/genesis_cli.py tools/tests package.json
git commit -m "feat: add lifecycle-aware Genesis artifacts"
```

---

### Task 2: Record ownership, deployment naming, and accepted architecture ADRs

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
- Consumes: Task 1 template and lifecycle rules; approved Pilot and Sprint 0 closeout specs.
- Produces: A repository that passes `pnpm genesis:validate`, with stable ownership and deployment identifiers referenced by later implementation and CI documentation.

- [ ] **Step 1: Add a failing repository-validation regression test for the real ADR directory**

```python
# Append to tools/tests/test_genesis_validator.py
class RepositoryArtifactRegressionTest(unittest.TestCase):
    def test_repository_architecture_artifacts_are_valid(self) -> None:
        failures = validate_repository(Path(__file__).resolve().parents[2])
        architecture_failures = [
            failure for failure in failures
            if failure.path.as_posix().startswith("docs/adr/")
        ]
        self.assertEqual(architecture_failures, [])
```

Run:

```bash
python -m unittest tools.tests.test_genesis_validator.RepositoryArtifactRegressionTest -v
```

Expected: FAIL because ADR-0001 lacks `Options Considered`, `Validation`, and `References`, and ADR-0002 through ADR-0006 do not exist.

- [ ] **Step 2: Write the ownership document**

`docs/ownership/DOMAIN-OWNERS.md` must contain:

```markdown
# Domain Ownership

## Accountable Owner

`hiephanguyen01` is the final decision authority and escalation point for the Booking OS Pilot.

## Domain Owners

| Domain | Domain owner | Accountable owner |
| --- | --- | --- |
| Identity | `unassigned` | `hiephanguyen01` |
| Tenancy | `unassigned` | `hiephanguyen01` |
| Catalog | `unassigned` | `hiephanguyen01` |
| Booking | `unassigned` | `hiephanguyen01` |
| Payment | `unassigned` | `hiephanguyen01` |
| Finance | `unassigned` | `hiephanguyen01` |

## Responsibilities

- Accountable owner: final product, architecture, risk, and escalation decisions.
- Domain owner: day-to-day technical and domain stewardship.
- Contributors and reviewers: implementation or review without ownership transfer.
```

State explicitly that assigning future domain owners changes this document, not the architecture.

- [ ] **Step 3: Write the deployment-unit naming document**

Freeze exactly:

```text
api
web-storefront
web-console
worker-critical
worker-batch
```

Document that package names, CI filters, deployment manifests, runbooks, logs, metrics, and dashboards use these identifiers; friendly UI labels do not replace them.

- [ ] **Step 4: Complete ADR-0001 and create ADR-0002 through ADR-0006**

Use Task 1's required ADR sections. Every new ADR must have:

```yaml
status: accepted
owner: hiephanguyen01
date: 2026-08-04
```

ADR content boundaries:

```text
ADR-0002: modular monolith, module boundaries, five deployment units, no microservice split
ADR-0003: tenant_id, FORCE RLS, transaction-local context, scoped repositories, audited bypass roles
ADR-0004: Browser -> BFF -> API, HTTP-only cookie, opaque token, server-derived tenant/partner scope
ADR-0005: same-transaction outbox, idempotent inbox, retries, stale claims, dead letter, sanitized errors
ADR-0006: Nest code-first source, committed spec/client, zero-diff generation, WARN gate, scoped waivers
```

Reference:

```text
docs/superpowers/specs/2026-08-04-booking-os-pilot-design.md
docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md
```

Do not duplicate implementation files line-by-line; record decision, alternatives, trade-offs, consequences, and verification evidence.

- [ ] **Step 5: Run validation and commit the governance baseline**

Run:

```bash
python -m unittest tools.tests.test_genesis_validator -v
pnpm genesis:validate
```

Expected: PASS with `Knowledge validation passed.`

Commit:

```bash
git add docs/ownership docs/architecture docs/adr tools/tests/test_genesis_validator.py
git commit -m "docs: record Sprint 0 architecture ownership"
```

---

### Task 3: Classify every NestJS HTTP route as supported or internal

**Files:**
- Create: `apps/api/src/api-visibility/api-visibility.decorator.ts`
- Create: `apps/api/src/api-visibility/api-visibility.resolver.ts`
- Create: `apps/api/src/api-visibility/api-route-inspector.ts`
- Create: `apps/api/src/api-visibility/api-visibility.resolver.test.ts`
- Create: `apps/api/src/api-visibility/api-route-inspector.test.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/tenancy/tenant-probe.controller.ts`
- Modify: any other NestJS HTTP controller discovered by the route inspector

**Interfaces:**
- Consumes: Nest controller and method metadata.
- Produces: `SupportedApi()`, `InternalApi()`, `resolveApiVisibility()`, and `inspectApiRoutes(app)` for the OpenAPI generator.

- [ ] **Step 1: Write failing visibility-resolution tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { InternalApi, SupportedApi } from "./api-visibility.decorator.js";
import { resolveApiVisibility } from "./api-visibility.resolver.js";

@InternalApi()
class InternalController {
  inherited(): void {}

  @SupportedApi()
  supportedOverride(): void {}
}

test("method visibility overrides controller visibility", () => {
  assert.equal(
    resolveApiVisibility(
      InternalController,
      InternalController.prototype.supportedOverride,
    ),
    "public-supported",
  );
  assert.equal(
    resolveApiVisibility(InternalController, InternalController.prototype.inherited),
    "internal",
  );
});

test("rejects missing and conflicting visibility", () => {
  class MissingController { route(): void {} }
  assert.throws(
    () => resolveApiVisibility(MissingController, MissingController.prototype.route),
    /exactly one API visibility/,
  );
});
```

- [ ] **Step 2: Run and observe missing modules**

Run:

```bash
pnpm --filter @booking-os/api test -- api-visibility
```

Expected: compile failure because the new files do not exist.

- [ ] **Step 3: Implement separate supported/internal metadata markers**

```ts
import { SetMetadata } from "@nestjs/common";

export const SUPPORTED_API_METADATA = Symbol("booking-os:supported-api");
export const INTERNAL_API_METADATA = Symbol("booking-os:internal-api");

export function SupportedApi(): ClassDecorator & MethodDecorator {
  return SetMetadata(SUPPORTED_API_METADATA, true);
}

export function InternalApi(): ClassDecorator & MethodDecorator {
  return SetMetadata(INTERNAL_API_METADATA, true);
}

export type ApiVisibility = "public-supported" | "internal";
```

`resolveApiVisibility(controller, handler)` must first inspect method-level markers. When either method marker exists, ignore controller defaults. At the selected level, require exactly one marker; reject both or neither.

- [ ] **Step 4: Write the failing real-route inspection test**

Create a Nest test application from `AppModule`, call `app.init()`, inspect routes, and assert:

```ts
assert.deepEqual(
  routes.map(({ method, path, visibility }) => ({ method, path, visibility })),
  [
    { method: "GET", path: "/api/health", visibility: "public-supported" },
    { method: "GET", path: "/api/ready", visibility: "public-supported" },
    // List each tenant probe route with visibility "internal" using its real path.
  ],
);
```

Sort by path then method. The test must fail when a fixture controller method lacks a marker.

- [ ] **Step 5: Implement route inspection and annotate controllers**

Use `ModulesContainer`, `MetadataScanner`, `Reflector`, `PATH_METADATA`, and `METHOD_METADATA`. Build the full path from the configured global prefix, controller path, and method path. Normalize duplicate slashes and always begin with `/`.

Annotate:

```ts
@SupportedApi()
@Controller()
export class HealthController { ... }
```

Annotate tenant-probe and diagnostic controllers with `@InternalApi()` at controller level. Do not change route paths or runtime behavior.

- [ ] **Step 6: Run route tests, API E2E tests, and commit**

Run:

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
```

Expected: PASS; existing health and tenant-isolation behavior unchanged.

Commit:

```bash
git add apps/api/src/api-visibility apps/api/src/health/health.controller.ts apps/api/src/tenancy
git commit -m "feat: classify supported and internal API routes"
```

---

### Task 4: Describe health and readiness with named OpenAPI models

**Files:**
- Create: `apps/api/src/openapi/health-openapi.dto.ts`
- Create: `apps/api/src/openapi/health-openapi.dto.test.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Existing `HealthResponse` runtime shape and Task 3 visibility markers.
- Produces: Named Swagger component schemas and stable operation IDs `getHealth` and `getReadiness`.

- [ ] **Step 1: Pin `@nestjs/swagger` and write a failing decorator metadata test**

Run:

```bash
pnpm --filter @booking-os/api add @nestjs/swagger@11.4.6 --save-exact
```

Write a test that uses `SwaggerModule.createDocument()` on a minimal app containing `HealthController` and asserts:

```ts
assert.equal(document.paths["/health"]?.get?.operationId, "getHealth");
assert.equal(document.paths["/ready"]?.get?.operationId, "getReadiness");
assert.ok(document.components?.schemas?.HealthResponseDto);
assert.ok(document.components?.schemas?.HealthDependencyStatusDto);
```

Expected before decorators: operation IDs are framework-generated and component schemas are absent.

- [ ] **Step 2: Add named DTOs that exactly mirror `HealthResponse`**

```ts
import { HEALTH_STATUSES } from "@booking-os/contracts/health";
import { ApiProperty, ApiPropertyOptional, getSchemaPath } from "@nestjs/swagger";

export class HealthDependencyStatusDto {
  @ApiProperty({ enum: HEALTH_STATUSES })
  status!: (typeof HEALTH_STATUSES)[number];

  @ApiPropertyOptional({ type: Number, minimum: 0 })
  latencyMs?: number;

  @ApiPropertyOptional({ type: String })
  message?: string;
}

export class HealthResponseDto {
  @ApiProperty() service!: string;
  @ApiProperty({ enum: HEALTH_STATUSES }) status!: (typeof HEALTH_STATUSES)[number];
  @ApiProperty() version!: string;
  @ApiProperty({ format: "date-time" }) timestamp!: string;
  @ApiProperty({ minimum: 0 }) uptimeSeconds!: number;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { $ref: getSchemaPath(HealthDependencyStatusDto) },
  })
  dependencies?: Record<string, HealthDependencyStatusDto>;
}
```

These classes are documentation models only; do not instantiate them in runtime handlers.

- [ ] **Step 3: Decorate supported endpoints without changing handler code**

Use:

```ts
@ApiTags("system")
@ApiExtraModels(HealthDependencyStatusDto)
@SupportedApi()
@Controller()
export class HealthController {
  @Get("health")
  @ApiOperation({ operationId: "getHealth" })
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth(): HealthResponse { ... }

  @Get("ready")
  @ApiOperation({ operationId: "getReadiness" })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async getReadiness(...): Promise<HealthResponse> { ... }
}
```

No security requirement is declared because these two endpoints are unauthenticated at runtime.

- [ ] **Step 4: Run focused and regression tests, then commit**

Run:

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
pnpm typecheck
```

Commit:

```bash
git add apps/api/src/openapi apps/api/src/health/health.controller.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat: document supported health API"
```

---

### Task 5: Generate a deterministic supported-only OpenAPI document

**Files:**
- Create: `apps/api/src/openapi/openapi-document.ts`
- Create: `apps/api/src/openapi/openapi-document.test.ts`
- Create: `apps/api/src/openapi/generate-openapi.ts`
- Modify: `apps/api/package.json`
- Create: `packages/contracts/openapi/openapi.json`
- Modify: `turbo.json` when generated outputs must be declared

**Interfaces:**
- Consumes: `inspectApiRoutes(app)` and Swagger metadata.
- Produces: `createSupportedOpenApiDocument(app)`, `normalizeOpenApiDocument(document)`, and the committed deterministic contract.

- [ ] **Step 1: Write failing document-filter and determinism tests**

The test must initialize `AppModule` without `listen()` and assert:

```ts
const first = await createSupportedOpenApiDocument(app);
const second = await createSupportedOpenApiDocument(app);

assert.deepEqual(Object.keys(first.paths), ["/api/health", "/api/ready"]);
assert.equal(JSON.stringify(first), JSON.stringify(second));
assert.equal(
  collectOperationIds(first).sort().join(","),
  "getHealth,getReadiness",
);
assert.equal(JSON.stringify(first).includes("tenant-probe"), false);
```

Also mutate a fixture document to contain duplicate `operationId: "getHealth"` and assert a deterministic error.

- [ ] **Step 2: Implement supported-route pruning and validation**

Create the full Swagger document, then prune path/method entries using the exact `{ method, path }` set returned by Task 3 where visibility is `public-supported`. Fail when:

```text
- a supported route is missing from Swagger output;
- a Swagger operation has no matching classified route;
- an included operation lacks operationId, tags, or a 2xx response;
- operationId is duplicated;
- an internal route survives pruning.
```

Preserve `parameters` and path-level metadata only when at least one supported operation remains.

- [ ] **Step 3: Implement recursive normalization**

```ts
export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
```

Additionally sort top-level `tags` by name and remove `servers`, timestamps, hostnames, and all `x-generated-*` fields. Serialize with `JSON.stringify(normalized, null, 2) + "\n"`.

- [ ] **Step 4: Implement the no-listen generator entry point**

Before dynamically importing `AppModule`, set deterministic defaults only when absent:

```ts
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:5432/booking_os_openapi";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379/15";
process.env.SESSION_SECRET ??= "openapi-generation-only-secret-32-characters";
process.env.PAYMENT_PROVIDER ??= "mock";
```

Then:

```ts
const app = await NestFactory.create(AppModule, { logger: false });
try {
  const environment = app.get(EnvironmentService);
  app.setGlobalPrefix(environment.apiPrefix);
  await app.init();
  const document = await createSupportedOpenApiDocument(app);
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
} finally {
  await app.close();
}
```

Assert through a child-process test that generation does not bind the configured port and exits even when PostgreSQL and Redis are unreachable.

- [ ] **Step 5: Add the API package script and generate twice**

Add:

```json
"openapi:generate": "tsx src/openapi/generate-openapi.ts"
```

Run:

```bash
pnpm --filter @booking-os/api openapi:generate
sha256sum packages/contracts/openapi/openapi.json
pnpm --filter @booking-os/api openapi:generate
sha256sum packages/contracts/openapi/openapi.json
git diff --exit-code -- packages/contracts/openapi/openapi.json
```

Expected: both hashes match; second generation has zero diff.

- [ ] **Step 6: Run API verification and commit**

Run:

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
pnpm --filter @booking-os/api typecheck
```

Commit:

```bash
git add apps/api/src/openapi apps/api/package.json packages/contracts/openapi turbo.json
git commit -m "feat: generate deterministic supported OpenAPI"
```

---

### Task 6: Generate runtime-free schema types and the thin operation client

**Files:**
- Modify: `package.json`
- Modify: `packages/api-client/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/openapi/generate-thin-client.mjs`
- Create: `scripts/openapi/generate-thin-client.test.mjs`
- Create: `scripts/openapi/fixtures/generator-contract.json`
- Create: `packages/api-client/src/generated/schema.ts`
- Create: `packages/api-client/src/generated/client.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: Normalized `packages/contracts/openapi/openapi.json`.
- Produces: `paths`, `operations`, `GeneratedRequest`, `GeneratedTransport`, `GeneratedClient`, and `createGeneratedClient(transport)`.

- [ ] **Step 1: Pin `openapi-typescript` and write a failing generator fixture test**

Run:

```bash
pnpm add -Dw openapi-typescript@7.13.0 --save-exact
```

The fixture must contain one operation with path, query, header, and JSON body parameters. Assert generated source contains:

```text
operationId method name
encodeURIComponent path interpolation
URLSearchParams query serialization
header forwarding
JSON request body
operations["fixtureOperation"] response typing
```

Run:

```bash
node --test scripts/openapi/generate-thin-client.test.mjs
```

Expected: FAIL because the generator does not exist.

- [ ] **Step 2: Implement the generator's supported subset and fail-closed behavior**

The generator must accept only OpenAPI 3.x JSON and iterate paths/methods in normalized order. For every operation, require `operationId` and generate an options type containing only parameter groups actually declared by that operation.

Generated shared interfaces:

```ts
// AUTO-GENERATED. DO NOT EDIT. Run `pnpm api:generate`.
import type { operations } from "./schema.js";

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

For the initial contract, emit:

```ts
export interface GeneratedClient {
  getHealth(options?: GeneratedRequestOptions): Promise<
    operations["getHealth"]["responses"][200]["content"]["application/json"]
  >;
  getReadiness(options?: GeneratedRequestOptions): Promise<
    operations["getReadiness"]["responses"][200]["content"]["application/json"]
  >;
}
```

Fail generation for duplicate operation IDs, unsupported non-JSON request bodies, callbacks, multipart bodies, or parameter serialization styles the generator does not implement. It is safer to stop than emit a misleading client.

- [ ] **Step 3: Add one command that generates both files**

Use:

```bash
pnpm exec openapi-typescript \
  packages/contracts/openapi/openapi.json \
  --output packages/api-client/src/generated/schema.ts \
  --immutable
node scripts/openapi/generate-thin-client.mjs \
  packages/contracts/openapi/openapi.json \
  packages/api-client/src/generated/client.ts
```

Add an overwrite warning to both outputs. If the upstream `openapi-typescript` header does not contain the repository command, prepend a stable header after generation.

- [ ] **Step 4: Export generated types without exposing implementation internals**

Append to `packages/api-client/src/index.ts`:

```ts
export type {
  GeneratedClient,
  GeneratedRequest,
  GeneratedRequestOptions,
  GeneratedTransport,
} from "./generated/client.js";
export { createGeneratedClient } from "./generated/client.js";
export type { operations, paths } from "./generated/schema.js";
```

Do not export generator scripts or raw parsed JSON.

- [ ] **Step 5: Generate twice, compile, test, and commit**

Run:

```bash
pnpm api:generate
sha256sum packages/api-client/src/generated/schema.ts packages/api-client/src/generated/client.ts
pnpm api:generate
sha256sum packages/api-client/src/generated/schema.ts packages/api-client/src/generated/client.ts
git diff --exit-code -- packages/contracts/openapi/openapi.json packages/api-client/src/generated
pnpm --filter @booking-os/api-client typecheck
pnpm --filter @booking-os/api-client test
node --test scripts/openapi/generate-thin-client.test.mjs
```

Commit:

```bash
git add package.json packages/api-client pnpm-lock.yaml scripts/openapi packages/contracts/openapi
git commit -m "feat: generate typed API client"
```

---

### Task 7: Put HTTP policy in the handwritten transport and preserve the public client

**Files:**
- Create: `packages/api-client/src/transport.ts`
- Create: `packages/api-client/tests/transport.test.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/index.ts`
- Modify: `packages/api-client/tests/client.test.ts`

**Interfaces:**
- Consumes: Task 6 `GeneratedTransport` and `createGeneratedClient()`.
- Produces: `createFetchTransport()` plus the unchanged `ApiClient.health.get()` adapter.

- [ ] **Step 1: Write failing transport tests for URL, headers, credentials, timeout, JSON, and errors**

Test options:

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

Assertions must cover:

```text
base URL normalization
path and query serialization
accept/content-type headers
caller headers overriding defaults except protected content type
credentials forwarding
x-request-id forwarding when supplied
AbortController timeout
non-2xx -> ApiClientError("http") with status
invalid JSON -> ApiClientError("invalid_response")
network -> ApiClientError("network") preserving cause
```

No automatic retry is enabled in Sprint 0; the handwritten transport owns that policy by deliberately making one request per call.

- [ ] **Step 2: Run focused tests and observe missing transport**

Run:

```bash
pnpm --filter @booking-os/api-client test -- transport
```

Expected: compile failure for `createFetchTransport`.

- [ ] **Step 3: Implement the fetch transport**

The transport must combine the generated relative path with `baseUrl`, append query values, pass the caller signal into a child timeout signal, and parse JSON only after a successful response.

```ts
export function createFetchTransport(options: FetchTransportOptions): GeneratedTransport {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const timeoutMs = parseTimeout(options.timeoutMs);
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return async <TResponse>(request, requestOptions): Promise<TResponse> => {
    const url = buildUrl(baseUrl, request.path, request.query);
    const controller = new AbortController();
    const removeParentAbort = forwardAbort(requestOptions?.signal, controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImplementation(url, {
        method: request.method,
        headers: buildHeaders(options, request),
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        credentials: options.credentials,
        signal: controller.signal,
      });
      return await parseResponse<TResponse>(response);
    } finally {
      clearTimeout(timeout);
      removeParentAbort();
    }
  };
}
```

Keep error messages operation-neutral; the generated adapter or public adapter may add context.

- [ ] **Step 4: Refactor `createApiClient()` behind the generated client**

Preserve:

```ts
export interface ApiClient {
  readonly health: {
    readonly get: () => Promise<HealthResponse>;
  };
}
```

Implementation:

```ts
const transport = createFetchTransport(options);
const generated = createGeneratedClient(transport);

async function getHealth(): Promise<HealthResponse> {
  const payload: unknown = await generated.getHealth();
  const result = healthResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiClientError(
      "invalid_response",
      "Health response does not match the contract",
      { cause: result.error },
    );
  }
  return result.data;
}
```

Do not remove Zod validation. Existing imports and call sites must compile unchanged.

- [ ] **Step 5: Run package and workspace regression tests, then commit**

Run:

```bash
pnpm --filter @booking-os/api-client test
pnpm --filter @booking-os/api-client typecheck
pnpm test
pnpm typecheck
```

Commit:

```bash
git add packages/api-client
git commit -m "refactor: use generated API transport adapter"
```

---

### Task 8: Validate exact, expiring compatibility waivers and gate oasdiff findings

**Files:**
- Create: `schemas/openapi-compatibility-waiver.schema.json`
- Create: `docs/api/compatibility-waivers/README.md`
- Create: `scripts/openapi/check-breaking.mjs`
- Create: `scripts/openapi/check-breaking.test.mjs`
- Create: `scripts/openapi/fixtures/compatible-base.json`
- Create: `scripts/openapi/fixtures/compatible-revision.json`
- Create: `scripts/openapi/fixtures/breaking-base.json`
- Create: `scripts/openapi/fixtures/breaking-revision.json`
- Create: `scripts/openapi/fixtures/waivers/valid.yaml`
- Create: `scripts/openapi/fixtures/waivers/expired.yaml`
- Create: `scripts/openapi/fixtures/waivers/out-of-scope.yaml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Base contract path, revision contract path, waiver directory, current date, and `oasdiff` executable.
- Produces: A fail-closed `check-breaking.mjs` process used locally and by CI.

- [ ] **Step 1: Pin YAML/schema dependencies and define the waiver schema**

Run:

```bash
pnpm add -Dw yaml@2.9.0 ajv@8.20.0 --save-exact
```

Schema fields:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id", "owner", "reason", "expiresOn", "baseContractSha256",
    "revisionContractSha256", "findings"
  ],
  "properties": {
    "id": { "type": "string", "pattern": "^API-WAIVER-[0-9]{4}$" },
    "owner": { "type": "string", "minLength": 1, "not": { "const": "unassigned" } },
    "reason": { "type": "string", "minLength": 20 },
    "expiresOn": { "type": "string", "format": "date" },
    "baseContractSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "revisionContractSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "findings": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
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

Use `ajv-formats` only if Ajv 8.20.0 does not validate `format: date` in the chosen draft; otherwise implement one exact `YYYY-MM-DD` format callback and compare parsed UTC dates yourself. Do not silently accept malformed dates.

- [ ] **Step 2: Write failing compatibility tests with a fake oasdiff executable**

The fake executable must support:

```text
breaking -f singleline BASE REVISION
breaking --fail-on WARN --err-ignore FILE --warn-ignore FILE BASE REVISION
```

Test cases:

```text
compatible contracts -> exit 0
breaking contracts without waiver -> exit 1
valid exact waiver for current contract hashes -> exit 0
expired waiver -> exit 1 before oasdiff ignore run
wrong base/revision hash -> waiver ignored and exit 1
fingerprint not present in raw findings -> waiver rejected as out of scope
invalid schema or duplicate waiver ID -> exit 2
missing oasdiff, unparseable output, or unexpected exit code -> exit 2
```

Inject the executable through `OASDIFF_BIN` and the clock through `OPENAPI_WAIVER_TODAY=2026-08-04`.

- [ ] **Step 3: Implement exact finding collection and temporary ignore files**

Algorithm:

```text
1. Read and SHA-256 both contracts.
2. Parse every *.yaml waiver and validate against the JSON Schema.
3. Select only unexpired waivers whose two hashes exactly match this contract pair.
4. Run `oasdiff breaking -f singleline BASE REVISION` without ignore files.
5. Treat each non-empty output line as the exact finding fingerprint.
6. Require every selected waiver fingerprint to exist in the raw report.
7. Regex-escape each exact fingerprint and write anchored ^...$ patterns to separate ERR/WARN temp files.
8. Run `oasdiff breaking --fail-on WARN --err-ignore ERR_FILE --warn-ignore WARN_FILE BASE REVISION`.
9. Exit 0 only on clean or fully waived findings; exit 1 on unwaived findings; exit 2 on tool/schema/IO errors.
10. Delete temp files in finally.
```

Never pass waiver text to a shell. Use `spawnSync(binary, args, { shell: false })`.

- [ ] **Step 4: Document the waiver workflow**

`README.md` must show:

```yaml
id: API-WAIVER-0001
owner: hiephanguyen01
reason: Correct the previously published response contract before Pilot consumers exist.
expiresOn: 2026-08-31
baseContractSha256: <64 lowercase hex characters>
revisionContractSha256: <64 lowercase hex characters>
findings:
  - severity: ERR
    fingerprint: GET /api/example removed the success response with the status '200'
```

Explain how to obtain single-line findings, calculate both hashes, why exact hashes prevent a waiver from broadening after subsequent edits, and that a new contract change requires a newly reviewed waiver.

- [ ] **Step 5: Run real oasdiff fixture tests and commit**

Install locally for the verification checkpoint:

```bash
go install github.com/oasdiff/oasdiff@v1.17.0
export PATH="$(go env GOPATH)/bin:$PATH"
```

Run:

```bash
node --test scripts/openapi/check-breaking.test.mjs
node scripts/openapi/check-breaking.mjs \
  scripts/openapi/fixtures/compatible-base.json \
  scripts/openapi/fixtures/compatible-revision.json \
  scripts/openapi/fixtures/waivers
```

Expected: tests PASS; compatible fixture exits 0; breaking fixture without waiver exits 1.

Commit:

```bash
git add schemas docs/api scripts/openapi package.json pnpm-lock.yaml
git commit -m "feat: gate scoped OpenAPI compatibility waivers"
```

---

### Task 9: Wire deterministic generation and compatibility checks into workspace scripts and CI

**Files:**
- Modify: `package.json`
- Modify: `packages/api-client/package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `turbo.json`
- Create: `scripts/check-generated.mjs`
- Create: `scripts/check-generated.test.mjs`

**Interfaces:**
- Consumes: Tasks 5–8 generators and compatibility runner.
- Produces: `pnpm api:generate`, `pnpm api:check-generated`, `pnpm api:check-breaking`, and protected CI jobs.

- [ ] **Step 1: Write the failing generated-drift script test**

Test in a temporary Git repository:

```text
clean generated files -> exit 0
source change that changes regenerated output -> exit 1 and list only declared generated paths
unrelated dirty file -> does not make this script fail
missing generated file -> exit 1
failed generator -> propagate non-zero exit
```

The script must invoke `pnpm api:generate`, then:

```bash
git diff --exit-code -- \
  packages/contracts/openapi/openapi.json \
  packages/api-client/src/generated
```

- [ ] **Step 2: Add root scripts with one source of truth**

```json
{
  "api:generate": "pnpm --filter @booking-os/api openapi:generate && openapi-typescript packages/contracts/openapi/openapi.json --output packages/api-client/src/generated/schema.ts --immutable && node scripts/openapi/generate-thin-client.mjs packages/contracts/openapi/openapi.json packages/api-client/src/generated/client.ts",
  "api:check-generated": "node scripts/check-generated.mjs",
  "api:check-breaking": "node scripts/openapi/check-breaking.mjs",
  "genesis:validate": "python tools/genesis_cli.py validate"
}
```

`api:check-breaking` accepts positional `BASE REVISION [WAIVER_DIRECTORY]`; print usage and exit 2 when paths are missing.

- [ ] **Step 3: Add an independent `api-contract` CI job**

The job must:

```yaml
api-contract:
  name: OpenAPI contract
  runs-on: ubuntu-latest
  timeout-minutes: 15
  env:
    NODE_ENV: test
    DATABASE_URL: postgresql://booking:booking@127.0.0.1:5432/booking_os_openapi
    REDIS_URL: redis://127.0.0.1:6379/15
    SESSION_SECRET: openapi-ci-only-secret-at-least-32-characters
    PAYMENT_PROVIDER: mock
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
    - uses: actions/setup-go@v6
      with:
        go-version: "1.24.x"
    - run: pnpm install --frozen-lockfile
    - run: go install github.com/oasdiff/oasdiff@v1.17.0
    - run: pnpm api:check-generated
    - run: pnpm --filter @booking-os/api-client typecheck
    - run: node --test scripts/openapi/*.test.mjs
```

- [ ] **Step 4: Add the pull-request-only base comparison**

Use one conditional step:

```yaml
- name: Materialize base OpenAPI contract
  if: github.event_name == 'pull_request'
  env:
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
  run: |
    mkdir -p .tmp/openapi
    git show "${BASE_SHA}:packages/contracts/openapi/openapi.json" > .tmp/openapi/base.json

- name: Reject unwaived OpenAPI breaking changes
  if: github.event_name == 'pull_request'
  run: pnpm api:check-breaking .tmp/openapi/base.json packages/contracts/openapi/openapi.json docs/api/compatibility-waivers
```

`git show` failure must fail the job. Do not fall back to an empty contract or skip the gate.

- [ ] **Step 5: Strengthen the knowledge CI job**

Run Python tests before validation:

```yaml
- name: Test Genesis tooling
  run: python -m unittest discover -s tools/tests -p 'test_*.py' -v
- name: Validate Genesis artifacts
  run: pnpm genesis:validate
```

Set up pnpm/Node in this job only when needed for `pnpm genesis:validate`; alternatively call the Python command directly and keep the root script covered in `quality`. Pick one approach and avoid duplicate dependency installation solely for a one-line alias.

- [ ] **Step 6: Run local CI-equivalent checks and commit**

Run:

```bash
pnpm install --frozen-lockfile
pnpm api:check-generated
pnpm api:check-breaking \
  scripts/openapi/fixtures/compatible-base.json \
  scripts/openapi/fixtures/compatible-revision.json \
  scripts/openapi/fixtures/waivers
pnpm genesis:validate
pnpm check:ci
pnpm lint
pnpm typecheck
pnpm test
```

Commit:

```bash
git add .github/workflows/ci.yml package.json packages/api-client/package.json turbo.json scripts/check-generated.mjs scripts/check-generated.test.mjs pnpm-lock.yaml
git commit -m "ci: enforce generated and compatible API contracts"
```

---

### Task 10: Close Sprint 0 documentation only after every gate passes

**Files:**
- Modify: `docs/backlog/SPRINT-0.md`
- Modify: `README.md`
- Modify: `docs/api/compatibility-waivers/README.md`
- Modify: `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md` only when implementation reveals a factual correction; do not change approved decisions silently

**Interfaces:**
- Consumes: All completed implementation tasks and their verification evidence.
- Produces: Accurate developer commands, a fully closed Sprint 0 backlog, and final proof that Foundation behavior remains green.

- [ ] **Step 1: Add a failing documentation-command smoke test when practical**

Use a small Node test to read `README.md` and assert it contains the four canonical commands:

```ts
for (const command of [
  "pnpm api:generate",
  "pnpm api:check-generated",
  "pnpm api:check-breaking",
  "pnpm genesis:validate",
]) {
  assert.match(readme, new RegExp(command.replaceAll(":", "\\:")));
}
```

Run and confirm it fails before README updates.

- [ ] **Step 2: Document local workflows**

README must explain:

```text
how to create ADR/Feature/Pattern artifacts
lifecycle validation rules
where the supported OpenAPI contract lives
how to regenerate spec and client
why generated files are committed
how to install pinned oasdiff 1.17.0
how to compare a base and revision contract
how to create, scope, expire, and remove a waiver
that Swagger UI is not exposed
that health.get remains the stable API-client entry point
```

Do not copy local secrets into general documentation; use the existing safe test-only examples.

- [ ] **Step 3: Mark backlog items complete only after focused acceptance checks pass**

Change these remaining items to `[x]`:

```text
Adopt ADR template
Adopt feature template
Adopt pattern template
Assign owners for Identity, Tenancy, Catalog, Booking, Payment, Finance
Freeze naming of deployment units
Record architecture baseline in ADRs
OpenAPI contract package
```

The ownership item is complete because the accountable owner and each explicit `unassigned` domain role are documented; it does not claim every role has a person.

- [ ] **Step 4: Run the complete Foundation verification on the final tree**

Start required PostgreSQL and Redis services, then run:

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

Expected: every command exits 0. Do not claim the OpenAPI breaking gate passed from a compatible fixture alone; also run the next two acceptance checks.

- [ ] **Step 5: Prove the compatibility gate blocks a breaking fixture**

Run:

```bash
set +e
pnpm api:check-breaking \
  scripts/openapi/fixtures/breaking-base.json \
  scripts/openapi/fixtures/breaking-revision.json \
  scripts/openapi/fixtures/waivers
status=$?
set -e
test "$status" -eq 1
```

Expected: the script reports at least one unwaived `ERR` or `WARN` finding and the shell assertion passes.

- [ ] **Step 6: Prove one exact active waiver passes while expired/out-of-scope waivers fail**

Run fixture-specific commands using `OPENAPI_WAIVER_TODAY=2026-08-04`:

```bash
OPENAPI_WAIVER_TODAY=2026-08-04 pnpm api:check-breaking \
  scripts/openapi/fixtures/breaking-base.json \
  scripts/openapi/fixtures/breaking-revision.json \
  scripts/openapi/fixtures/waivers/valid
```

Then assert expired and out-of-scope directories exit non-zero. Save command output in the PR description, not as committed generated logs.

- [ ] **Step 7: Review the final diff for scope and generated provenance**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
```

Confirm:

```text
no Prisma migration
no partner/catalog/booking implementation
no Swagger UI route
no direct edits that regeneration overwrites
no TODO/TBD in accepted or active Genesis artifacts
no broad compatibility bypass
all generated headers identify pnpm api:generate
```

- [ ] **Step 8: Commit the closeout and push for CI**

```bash
git add README.md docs/backlog/SPRINT-0.md docs/api
git commit -m "docs: close Sprint 0 governance and contracts"
git push -u origin feat/sprint-0-closeout
```

Open a pull request to `main` whose body includes:

```text
Summary of Genesis/governance/OpenAPI deliverables
Explicit non-goals
Generated-artifact commands
Compatibility fixture evidence
Full Foundation verification commands and results
Statement that no database migration is included
```

Wait for all permanent CI jobs, including `OpenAPI contract`, to pass on the final head SHA before requesting merge.

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 cover templates, lifecycle validation, ownership, frozen deployment units, and five accepted ADRs. Tasks 3–7 cover route classification, supported-only deterministic OpenAPI, committed generated schema/client, and source-compatible runtime integration. Tasks 8–9 cover exact expiring waivers, WARN-level blocking, fail-closed base comparison, generation drift, and CI. Task 10 covers documentation, backlog closure, rollback-safe final verification, and concrete compatibility acceptance evidence.
- **Placeholder scan:** No committed implementation step permits `TODO`, `TBD`, ellipses, or template placeholders. The two illustrative ellipses in Task 1 are explicitly prohibited from the committed test and must be replaced with concrete fixture setup before the failing-test run.
- **Type consistency:** The plan consistently uses `GeneratedTransport`, `GeneratedRequest`, `GeneratedRequestOptions`, `GeneratedClient`, `createGeneratedClient()`, `createFetchTransport()`, `ApiVisibility`, `SupportedApi()`, `InternalApi()`, and `inspectApiRoutes(app)` across producer and consumer tasks.
- **Scope check:** Governance and OpenAPI are separate implementation areas but form the one approved, independently releasable Sprint 0 closeout. Each task has a focused review gate; the PR does not include the next Partner → Bookable Inventory slice.
