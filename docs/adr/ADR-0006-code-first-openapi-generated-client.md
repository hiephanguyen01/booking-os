---
id: ADR-0006
title: Code-first OpenAPI and Committed Generated Client
status: accepted
owner: hiephanguyen01
date: 2026-08-04
---

# Code-first OpenAPI and Committed Generated Client

## Context

Booking OS needs an explicit supported HTTP contract, reviewable client changes, and a path to compatibility enforcement without maintaining a separate handwritten specification that can drift from NestJS handlers.

## Problem

Handwritten API clients and independently maintained specifications duplicate route, parameter, and response knowledge. Generating artifacts only during unpublished builds hides contract changes from pull-request review and makes builds depend on implicit tooling.

## Options Considered

1. Maintain OpenAPI manually and keep handwritten clients.
2. Generate OpenAPI from NestJS metadata and commit the derived contract and client.
3. Generate a framework-specific SDK at runtime without committing artifacts.

## Decision

NestJS controllers, named response models, and OpenAPI decorators are the source of truth for supported API operations. Generate a deterministic supported-only document at `packages/contracts/openapi/openapi.json`.

Generate runtime-free TypeScript schema types and a thin framework-agnostic operation client under `packages/api-client/src/generated/`. Keep base URLs, credentials, request IDs, timeouts, normalized errors, and Zod boundary validation in handwritten code outside the generated directory.

Generated artifacts are committed and CI regenerates them to require a zero diff. Compatibility comparison and exact expiring waivers are enabled in the subsequent compatibility-gate pull request after the first baseline exists in `main`.

## Trade-offs

The repository carries generated files and must keep generation deterministic. In return, contract changes are visible during review, consumers receive stable types, and the build does not depend on hidden generation.

## Consequences

Every supported endpoint requires a stable operation ID, domain tag, named schemas, explicit responses, and an explicit route classification. Internal routes remain operational but are absent from the supported contract. Direct edits to generated files are overwritten and rejected by the drift check.

## Validation

Tests assert route classification, internal-route exclusion, operation-ID uniqueness, named health schemas, deterministic double generation, generated-client compilation, handwritten transport behavior, Zod validation, and source compatibility of `createApiClient({ baseUrl }).health.get()`.

## References

- `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md`
- `docs/superpowers/specs/2026-08-04-sprint-0-closeout-delivery-amendment.md`
- `docs/superpowers/plans/2026-08-04-sprint-0-baseline.md`
