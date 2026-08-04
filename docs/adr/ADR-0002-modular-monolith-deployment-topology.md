---
id: ADR-0002
title: Modular Monolith and Deployment Topology
status: accepted
owner: hiephanguyen01
date: 2026-08-04
---

# Modular Monolith and Deployment Topology

## Context

Booking OS must deliver the Pilot quickly while preserving clear domain boundaries, reliable background processing, and independent web experiences for customers and operators.

## Problem

A single undifferentiated application would make domain ownership and background work difficult to reason about, while premature microservices would add deployment, networking, tracing, and consistency costs before the product has proven scale requirements.

## Options Considered

1. One process containing every web, API, and worker responsibility.
2. A modular monolith with a small fixed set of deployment units.
3. Independent microservices for each business domain.

## Decision

Use a modular monolith with explicit domain modules and five deployment units:

```text
api
web-storefront
web-console
worker-critical
worker-batch
```

The API owns business orchestration and persistence boundaries. Storefront and console remain separate web deployment units. Critical and batch workers separate latency-sensitive processing from lower-priority jobs without splitting domain ownership into network services.

## Trade-offs

The system keeps shared code and database coordination simple, but deployments may still include code for multiple domains. Domain boundaries therefore depend on module interfaces, review discipline, and tests rather than network isolation.

## Consequences

New product capabilities are implemented as modules and vertical slices inside the monolith. A new deployment unit or service split requires an accepted ADR with operational evidence. Package names, CI filters, runbooks, metrics, and manifests use the frozen identifiers.

## Validation

The Foundation build, Docker Compose configuration, health checks, worker tests, and Playwright smoke cover all five deployment units. Future slices must preserve module boundaries and avoid direct cross-domain persistence access.

## References

- `docs/architecture/DEPLOYMENT-UNITS.md`
- `docs/superpowers/specs/2026-08-04-booking-os-pilot-design.md`
- `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md`
