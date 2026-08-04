# Sprint 0 Closeout: Governance and OpenAPI Foundation Design

**Status:** Approved design

**Date:** 2026-08-04

**Accountable owner:** `hiephanguyen01`

**Target branch for implementation:** A new feature branch from `main`

## 1. Context

The Booking OS Pilot Foundation is merged into `main`. The repository now has runnable deployment units, strict TypeScript, PostgreSQL and Redis readiness, request correlation, normalized errors, Prisma with PostgreSQL row-level security, an opaque BFF session proof, transactional inbox/outbox primitives, workers, migration gates, and Playwright foundation coverage.

Sprint 0 still has a small set of unfinished governance and API-contract items:

- adopt ADR, feature, and pattern templates;
- assign domain ownership;
- freeze deployment-unit names;
- record the architecture baseline in ADRs;
- establish the OpenAPI contract package and compatibility gate.

This design closes those items in one focused pull request before the next business vertical slice, Partner → Bookable Inventory.

## 2. Goals

The pull request defined by this design will:

1. Make Genesis artifact creation repeatable and validated.
2. Record the approved Foundation architecture as accepted ADRs.
3. Make repository ownership and deployment naming explicit.
4. Generate a deterministic, committed OpenAPI document from supported NestJS endpoints.
5. Generate a framework-agnostic TypeScript client from that document.
6. Prevent unreviewed breaking API changes from merging.
7. Close every remaining Sprint 0 backlog item without adding partner, catalog, scheduling, pricing, or booking behavior.

## 3. Non-goals

This work will not:

- implement partner onboarding, verification, resources, listings, pricing, availability, or publishing;
- expose Swagger UI in production;
- document internal or experimental endpoints as supported API;
- generate React Query hooks or framework-specific SDKs;
- replace Zod runtime validation in `@booking-os/contracts`;
- change database schema, tenant isolation behavior, queue semantics, session behavior, or payment behavior;
- introduce a new deployment unit or a new OpenAPI package.

## 4. Approved Decisions

| Area | Decision |
| --- | --- |
| Delivery | Close Sprint 0 in one small PR before the next vertical slice. |
| Ownership | `hiephanguyen01` is accountable owner; domain-owner roles remain `unassigned` until more team members join. |
| Deployment names | Freeze `api`, `web-storefront`, `web-console`, `worker-critical`, and `worker-batch`. |
| Templates | Store canonical templates in `genesis/templates/` and generate artifacts through Genesis CLI. |
| Validation | Apply lifecycle-aware validation: drafts may be incomplete; accepted/active artifacts must be complete. |
| Architecture records | Create multiple small accepted ADRs, one decision per ADR. |
| OpenAPI source | Code-first from NestJS decorators. |
| Contract storage | Commit `packages/contracts/openapi/openapi.json`. |
| Client storage | Commit generated files in `packages/api-client/src/generated/`. |
| Client style | Generate runtime-free TypeScript types and a thin framework-agnostic fetch client. |
| Generation drift | CI regenerates spec/client and requires a zero Git diff. |
| Compatibility | Compare the PR contract with `main`; block breaking changes unless precisely waived. |
| Waivers | Store versioned, scoped, expiring waivers under `docs/api/compatibility-waivers/`. |
| Supported API | Include only supported endpoints. Health and readiness are supported; tenant probe and Foundation-only routes are internal. |
| Tooling | Use `@nestjs/swagger`, `openapi-typescript`, an internal thin-client generator, and `oasdiff`. |

## 5. Scope and Deliverables

### 5.1 Genesis templates and CLI

Canonical templates:

```text
genesis/templates/
  ADR.md
  FEATURE.md
  PATTERN.md
```

CLI modules:

```text
tools/genesis_cli.py
tools/genesis/
  artifact_types.py
  frontmatter.py
  generator.py
  validator.py
```

Supported commands:

```bash
python tools/genesis_cli.py validate
python tools/genesis_cli.py new-adr "Decision title"
python tools/genesis_cli.py new-feature "Feature title"
python tools/genesis_cli.py new-pattern "Pattern title"
```

`tools/genesis_cli.py` remains the stable command entry point. The modules under `tools/genesis/` hold parsing, generation, classification, and validation behavior so each concern can be tested independently.

### 5.2 Governance records

The PR will add:

- a domain-ownership document;
- a deployment-topology document or section that freezes the five names;
- five accepted architecture ADRs;
- an updated `docs/backlog/SPRINT-0.md` with all remaining items checked only after their acceptance tests pass.

### 5.3 OpenAPI artifacts

Committed artifacts:

```text
packages/contracts/openapi/openapi.json
packages/api-client/src/generated/schema.ts
packages/api-client/src/generated/client.ts
```

Handwritten client code remains outside `src/generated/`. The generated directory must carry a header stating that direct edits are overwritten.

### 5.4 Compatibility waivers

Waivers use YAML files:

```text
docs/api/compatibility-waivers/<waiver-id>.yaml
```

A repository schema validates their structure. A waiver is data, not a shell flag or a global bypass.

## 6. Genesis Artifact Model

### 6.1 Artifact lifecycles and locations

Allowed states:

| Artifact | Draft states | Completed states | Historical states |
| --- | --- | --- | --- |
| ADR | `proposed` | `accepted` | `superseded`, `rejected` |
| Feature | `draft` | `active` | `deprecated` |
| Pattern | `draft` | `active` | `deprecated` |

Canonical destinations and IDs:

| Artifact | Destination | ID format | Initial status |
| --- | --- | --- | --- |
| ADR | `docs/adr/` | `ADR-0001` | `proposed` |
| Feature | `docs/features/` | `FEATURE-0001` | `draft` |
| Pattern | `docs/patterns/` | `PATTERN-0001` | `draft` |

Every artifact requires YAML-like front matter with at least:

```yaml
id: ADR-0002
title: Modular monolith and deployment topology
status: accepted
owner: hiephanguyen01
date: 2026-08-04
```

Generation scans only the artifact’s canonical destination, selects the next numeric ID for that artifact type, and refuses to overwrite an existing path.

### 6.2 Lifecycle-aware validation

For `proposed` and `draft` artifacts:

- metadata fields and allowed status are mandatory;
- all required headings must exist;
- `owner: unassigned` is allowed;
- sections may be empty while the artifact is being developed.

For `accepted` and `active` artifacts:

- owner must not be empty or `unassigned`;
- every required section must contain substantive text;
- `TODO`, `TBD`, template instructions, placeholder markers, and empty sections are forbidden;
- IDs must be unique within the repository;
- front matter must contain only a valid status for the artifact type.

Historical artifacts retain the completeness rules of completed artifacts because they remain part of the architecture record.

Templates are validated as templates, not classified as real artifacts. Their placeholders are permitted only inside `genesis/templates/`.

### 6.3 Required sections

ADR:

- Context
- Problem
- Options Considered
- Decision
- Trade-offs
- Consequences
- Validation
- References

Feature:

- Problem
- Goal
- Non-goals
- Business Rules
- Acceptance Criteria
- Test Plan

Pattern:

- Problem
- Context
- Solution
- Trade-offs
- Review Checklist

### 6.4 Generator behavior

Generation flow:

```text
command
→ resolve artifact type
→ allocate next ID
→ read canonical template
→ substitute ID, title, status, owner, date, and slug
→ write atomically to the destination directory
→ validate the new artifact
→ print the repository-relative path
```

Generation must fail without leaving a partial file when the destination exists, the template is invalid, the artifact title cannot produce a usable slug, or post-generation validation fails.

## 7. Ownership and Deployment Naming

### 7.1 Ownership model

`hiephanguyen01` is the accountable owner for the product and repository during the pilot.

The following domain-owner roles exist but initially have no assignee:

- Identity
- Tenancy
- Catalog
- Booking
- Payment
- Finance

The ownership document distinguishes:

- **Accountable owner:** final decision authority and escalation point.
- **Domain owner:** day-to-day technical and domain stewardship.
- **Contributors/reviewers:** people who implement or review without owning the domain.

Adding team members changes only the ownership document. It does not require an architecture change.

### 7.2 Frozen deployment-unit names

The canonical deployment-unit names are:

```text
api
web-storefront
web-console
worker-critical
worker-batch
```

Package names, CI filters, deployment manifests, runbooks, metrics, dashboards, and future ADRs must use these identifiers. Friendly product labels may be shown in UI or documentation, but they do not replace the canonical names.

## 8. Architecture Baseline ADRs

The PR creates five accepted ADRs owned by `hiephanguyen01`:

1. **Modular monolith and deployment topology** — records module boundaries and the five deployment units.
2. **PostgreSQL RLS tenant isolation** — records `tenant_id`, forced RLS, transaction-local tenant context, scoped repositories, and audited bypass roles.
3. **Opaque BFF sessions and browser trust boundary** — records Browser → BFF → API, HTTP-only cookies, opaque tokens, and server-derived scope.
4. **Transactional inbox/outbox reliability** — records same-transaction outbox writes, idempotent inbox processing, retries, stale claims, and dead-letter behavior.
5. **Code-first OpenAPI and committed generated client** — records source of truth, generated artifacts, compatibility checks, and waiver policy.

Each ADR references the approved Booking OS Pilot design and the concrete Foundation implementation where relevant. The ADRs describe current decisions; they do not restate every implementation detail.

## 9. Supported API Classification

Every HTTP route must resolve to exactly one of:

- `public-supported`: included in the committed OpenAPI contract and protected by compatibility guarantees;
- `internal`: excluded from the supported contract and free to evolve within repository review rules.

The implementation will provide explicit NestJS metadata decorators, conceptually:

```ts
@SupportedApi()
@InternalApi()
```

A controller marker supplies the default classification for its methods. A method marker may explicitly override that controller default. A single controller or method declaration cannot carry both markers, and the resolved classification for every route must be exactly one value. Route-classification tests evaluate the resolved result, not merely the presence of decorators.

Initial classification:

| Route | Classification |
| --- | --- |
| `GET /api/health` | `public-supported` |
| `GET /api/ready` | `public-supported` |
| Tenant probe routes | `internal` |
| Foundation-only diagnostic routes | `internal` |
| Session BFF routes in Next.js | Outside the NestJS API contract |

The OpenAPI generator includes only `public-supported` NestJS routes. Internal routes remain operational but do not appear in `openapi.json`.

## 10. OpenAPI Generation

### 10.1 Source of truth

NestJS controllers, DTOs, response models, and Swagger decorators are the source of truth. `openapi.json` and the generated client are derived artifacts.

Every supported endpoint requires:

- a unique, stable `operationId`;
- a domain tag;
- documented path, query, header, and body parameters;
- explicit success responses;
- explicit normalized error responses where applicable;
- security metadata that matches runtime behavior;
- named DTO/model schemas rather than undocumented anonymous objects.

### 10.2 Generator bootstrap

The generator creates and initializes the NestJS application without calling `listen()`, generates the document with `SwaggerModule.createDocument()`, then closes all application resources.

Generation must not:

- bind a network port;
- require production credentials;
- enqueue jobs;
- mutate the database;
- write any file other than the declared generated artifacts.

A dedicated generation environment supplies safe deterministic configuration. Dependencies that are unnecessary for document creation must be replaceable by inert providers or must initialize without external side effects.

### 10.3 Deterministic normalization

Before writing `openapi.json`, a normalizer:

- sorts paths, methods, components, tags, and object keys consistently;
- emits stable indentation and a final newline;
- removes timestamps, absolute paths, host-specific values, and other volatile metadata;
- validates that operation IDs are unique;
- validates that all included routes are classified `public-supported`;
- validates that excluded internal routes are absent.

Running generation twice against the same source tree must produce byte-identical output.

### 10.4 No production Swagger surface

Sprint 0 generates a file during development and CI. It does not mount Swagger UI or raw Swagger endpoints in production. A future ADR may introduce a protected documentation surface, but that is outside this work.

## 11. Generated API Client

### 11.1 Generated types

`openapi-typescript` reads `packages/contracts/openapi/openapi.json` and writes runtime-free types to:

```text
packages/api-client/src/generated/schema.ts
```

Exact dependency versions are pinned in the workspace and lockfile during implementation.

### 11.2 Thin client generator

A small repository-owned generator reads the normalized OpenAPI document and emits one method per stable `operationId` into:

```text
packages/api-client/src/generated/client.ts
```

The generated layer is responsible only for:

- method, path, and parameter mapping;
- request and response TypeScript types;
- serialization of path, query, headers, and JSON bodies;
- delegating the HTTP call to an injected transport.

The generated layer does not own:

- environment-specific base URLs;
- cookie/session forwarding policy;
- request IDs;
- retry rules;
- timeouts;
- logging;
- user-facing error mapping;
- React, Next.js, NestJS, or TanStack Query integration.

### 11.3 Handwritten transport and wrapper

Handwritten code outside `src/generated/` provides a fetch-based transport and preserves the package’s framework-agnostic boundary. It owns:

- `baseUrl` resolution;
- default headers;
- credentials mode;
- optional request ID propagation;
- abort/timeout support;
- normalized API errors;
- narrowly scoped retry behavior where explicitly enabled.

Existing health-client public exports must remain source-compatible. The generated client is introduced behind adapters when necessary so repository consumers do not require a breaking import or call-site change in this PR.

### 11.4 Runtime validation

Generated TypeScript types do not replace runtime validation. Zod schemas in `@booking-os/contracts` remain the runtime validation mechanism where untrusted data crosses a boundary.

## 12. Generated-Artifact Rules

Repository scripts:

```bash
pnpm api:generate
pnpm api:check-generated
pnpm api:check-breaking
pnpm genesis:validate
```

`api:generate` produces the normalized OpenAPI file and both generated TypeScript files.

`api:check-generated` runs generation and then requires:

```bash
git diff --exit-code -- \
  packages/contracts/openapi/openapi.json \
  packages/api-client/src/generated
```

Direct edits to generated files are rejected by review convention and detected by regeneration drift. Generated files are committed so contract changes are visible in pull-request review and builds do not depend on hidden code generation.

## 13. Compatibility Gate

### 13.1 Baseline

For pull requests, CI retrieves `packages/contracts/openapi/openapi.json` from the PR base commit on `main` and compares it with the generated PR contract.

The check fails closed when:

- the baseline cannot be retrieved;
- either document is invalid;
- `oasdiff` cannot execute;
- output cannot be parsed;
- an unwaived breaking change exists.

A push to `main` still validates and regenerates artifacts, but the merge-protection comparison runs on pull requests where a base contract exists.

### 13.2 Breaking-change policy

The gate blocks at least:

- endpoint or supported method removal;
- success response removal;
- required request parameter addition;
- optional request field becoming required;
- response field removal where consumers may depend on it;
- type narrowing;
- enum-value removal;
- incompatible security-requirement changes.

Compatible additions, such as a new endpoint or an optional response field, are allowed but remain visible in the contract diff.

CI runs `oasdiff breaking` with failure threshold `WARN`; therefore both definite `ERR` changes and potential `WARN` compatibility breaks block merge. A breaking fingerprint may pass only through an exact active waiver. Changing the threshold or downgrading a check requires a reviewed architecture decision rather than an ad hoc CI edit.

### 13.3 Waiver schema

Each waiver file contains:

```yaml
id: API-WAIVER-0001
status: active
owner: hiephanguyen01
reason: Correct an incorrectly published response schema before external consumers exist.
created_on: 2026-08-04
expires_on: 2026-08-18
changes:
  - rule_id: response-property-requiredness-changed
    method: GET
    path: /api/example
    operation_id: getExample
    location: responses.200.content.application/json.schema
```

`rule_id` is the repository’s normalized identifier derived from structured `oasdiff` output. The normalizer and its fixtures define the stable mapping independently from human-readable tool messages.

Required rules:

- `id` is unique;
- `status` is `active`, `expired`, or `revoked`;
- owner is assigned;
- reason is substantive;
- `expires_on` is on or after the CI evaluation date for an active waiver;
- an active waiver is valid through the end of `expires_on` in UTC and expires at the next UTC date boundary;
- every change entry identifies one normalized breaking-change fingerprint;
- a waiver cannot use wildcards for all operations, paths, or rules;
- expired or revoked waivers never suppress a failure;
- an active waiver entry that matches no current breaking change fails as stale configuration;
- every reported breaking change must either be absent or match exactly one active waiver entry.

CI parses structured `oasdiff` output, normalizes each result into a stable fingerprint, and matches it against waiver entries. It does not disable `oasdiff` globally and does not accept an environment-variable bypass.

## 14. CI Design

The closeout PR adds or extends jobs so the effective order is:

```text
Genesis template and artifact validation
→ OpenAPI route-classification tests
→ OpenAPI generation
→ deterministic regeneration check
→ generated-client compile and tests
→ compatibility and waiver check
→ existing quality, unit, integration, migration, build, Playwright, production-guard, and security gates
```

Jobs may run in parallel where dependencies allow, but merge protection must require every gate.

CI output must make failures actionable by printing:

- invalid artifact path and rule;
- unclassified or multiply classified route;
- duplicate operation ID;
- generated files that drifted;
- normalized breaking-change fingerprints;
- matching, expired, stale, or missing waiver IDs.

No job may print credentials, environment dumps, session tokens, database URLs, or cookies.

## 15. Error Handling

### 15.1 Genesis errors

The CLI returns non-zero and leaves no partial output for:

- missing or malformed template;
- invalid front matter;
- invalid lifecycle status;
- duplicate ID;
- destination collision;
- incomplete accepted/active artifact;
- forbidden placeholder in a completed artifact.

Errors include the repository-relative path and a concise remediation message.

### 15.2 OpenAPI errors

Generation returns non-zero for:

- application bootstrap failure;
- side-effectful dependency initialization;
- unclassified route;
- internal route included in the supported document;
- supported route omitted from the document;
- missing or duplicate operation ID;
- undocumented supported response;
- nondeterministic output;
- invalid OpenAPI schema.

The generation script always closes the Nest application in a `finally` block.

### 15.3 Client errors

The handwritten transport maps network failures, timeouts, malformed responses, and normalized API error envelopes into stable package error types. Generated methods do not silently coerce failed responses into successful return values.

## 16. Test Strategy

### 16.1 Genesis tests

- front-matter parsing;
- artifact classification;
- allowed and rejected lifecycle statuses;
- draft acceptance with empty sections and `unassigned` owner;
- accepted/active rejection for empty content, placeholders, or unassigned owner;
- duplicate-ID detection;
- sequential ID allocation;
- template rendering;
- destination collision and atomic-write behavior;
- CLI integration tests in a temporary repository tree.

### 16.2 OpenAPI tests

- `/api/health` and `/api/ready` appear;
- tenant probe and Foundation-only routes do not appear;
- every Nest HTTP route has exactly one resolved classification;
- operation IDs are unique and stable;
- supported responses have schemas;
- document validates as OpenAPI;
- generation twice is byte-identical;
- generator initializes and closes without binding a port.

### 16.3 Client tests

- generated code compiles under strict TypeScript;
- path and query serialization;
- headers and JSON body forwarding;
- injected transport usage;
- timeout and abort behavior in the handwritten wrapper;
- normalized API error mapping;
- existing health-client public-export compatibility.

### 16.4 Compatibility tests

Fixtures prove that CI:

- allows a compatible endpoint addition;
- blocks endpoint removal;
- blocks optional-to-required changes;
- blocks enum narrowing;
- blocks both `ERR` and `WARN` findings;
- accepts an exact active waiver;
- rejects expired, revoked, malformed, overbroad, unmatched, and partially matching waivers;
- fails when the baseline or comparison tool is unavailable.

### 16.5 Regression gates

All existing Foundation tests remain required, including health/readiness behavior, tenant isolation, opaque sessions, inbox/outbox, migration verification, Playwright smoke, and the production mock-payment guard.

## 17. Rollout and Rollback

### 17.1 Rollout order

1. Add templates, CLI modules, lifecycle validation, and tests.
2. Add ownership and deployment-name records.
3. Add and validate the five accepted ADRs.
4. Add explicit API route classification.
5. Add deterministic OpenAPI generation for health and readiness.
6. Add generated types, thin client, and handwritten transport.
7. Add compatibility fixtures, waiver validation, and CI integration.
8. Run the complete repository verification suite.
9. Mark Sprint 0 backlog items complete only after all corresponding checks pass.

### 17.2 Rollback

This scope has no database migration or persistent-data mutation. Rollback is a normal Git revert of the closeout PR.

Reverting removes governance automation and generated-contract enforcement but does not require database, queue, payment, or object-storage recovery. Existing runtime health/readiness implementations remain available through their pre-closeout code paths.

## 18. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Nest application initialization causes external side effects during generation. | Isolate generation bootstrap, inject inert providers where needed, prohibit `listen()`, and test no port binding or mutation. |
| Swagger decorators drift from actual runtime responses. | Add endpoint response tests and OpenAPI schema assertions; preserve Zod runtime validation. |
| Generated output changes nondeterministically. | Canonical sorting, volatile-field removal, double-generation test, and Git diff gate. |
| API compatibility tool produces false positives. | Pin tool/config, exercise repository fixtures, use exact short-lived waivers rather than a global bypass. |
| Waivers accumulate indefinitely. | Require expiry, reject stale entries, and keep every waiver versioned and owner-assigned. |
| Governance validation becomes too strict for early drafts. | Apply completeness only to accepted/active and historical completed artifacts. |
| Internal route is accidentally published. | Require exactly-one resolved route classification and test internal-route absence. |
| Client generator becomes a second framework. | Limit output to operation mapping and injected transport; keep policy in handwritten code. |

## 19. Definition of Done

Sprint 0 is complete only when all of the following are true:

- ADR, feature, and pattern templates exist under `genesis/templates/`.
- `new-adr`, `new-feature`, `new-pattern`, and `validate` work through the stable CLI entry point.
- Lifecycle validation is covered by unit and CLI integration tests.
- Ownership records identify `hiephanguyen01` as accountable owner and the six domain-owner roles as `unassigned`.
- The five deployment-unit names are explicitly frozen.
- Five accepted architecture ADRs pass completed-artifact validation.
- Health and readiness are classified and emitted as supported OpenAPI operations.
- Tenant probe and Foundation-only routes are classified internal and absent from the contract.
- `openapi.json`, generated types, and the thin client are committed.
- Regeneration is deterministic and produces no diff.
- Generated client and handwritten wrapper compile and pass tests.
- A fixture breaking change at both `ERR` and `WARN` levels is blocked by CI.
- Exact active waiver fixtures pass; expired, stale, overbroad, and out-of-scope waiver fixtures fail.
- Existing Foundation verification remains green.
- Every remaining checkbox in `docs/backlog/SPRINT-0.md` is checked with corresponding implementation evidence.

## 20. Acceptance Criteria

The closeout PR is acceptable when a reviewer can:

1. Generate each knowledge artifact from a canonical template into its defined destination with its defined ID prefix.
2. Observe lifecycle validation reject an incomplete accepted artifact while allowing an incomplete draft.
3. Read the ownership, deployment naming, and five ADR decisions without consulting chat history.
4. Regenerate the supported API contract and client from source with one command.
5. Confirm the working tree remains clean after regeneration.
6. Confirm internal routes never appear in the supported contract.
7. Introduce an `ERR` or `WARN` breaking fixture and see CI reject it.
8. Add one exact, valid, short-lived waiver and see only that breaking fingerprint suppressed.
9. Run the full Foundation suite successfully.

## 21. References

- `docs/superpowers/specs/2026-08-04-booking-os-pilot-design.md`
- `docs/superpowers/plans/2026-08-04-booking-os-pilot-foundation.md`
- `docs/backlog/SPRINT-0.md`
- `tools/genesis_cli.py`
- `packages/api-client/`
- NestJS OpenAPI generation through `SwaggerModule.createDocument()`
- `openapi-typescript` CLI generation from local JSON/YAML specifications
- `oasdiff breaking` and structured breaking-change comparison
