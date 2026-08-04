---
id: ADR-0001
title: Build Booking Before Extracting Genesis
status: accepted
owner: hiephanguyen01
date: 2026-08-03
---

# Build Booking Before Extracting Genesis

## Context

The repository has a complete Booking SaaS product specification and an ambition to extract reusable Genesis standards, workflows, templates, and patterns from real delivery work.

## Problem

Building an independent Genesis runtime or platform before Booking would create framework scope without a proven production use case, divert effort from the Pilot, and make standards difficult to validate against real constraints.

## Options Considered

1. Build Genesis as an independent platform before implementing Booking.
2. Build Booking first and extract Genesis knowledge from validated vertical slices.
3. Develop both as equal products from the beginning.

## Decision

Booking SaaS is the priority product. Genesis remains in this repository as standards, workflows, templates, reviews, and patterns extracted from the implementation of Booking.

An artifact becomes a Genesis standard only after it has been used and validated in a real vertical slice. Repeated evidence is required before a pattern is automated or generalized.

## Trade-offs

This decision accepts a smaller, initially manual Genesis system and slower framework extraction in exchange for evidence-driven standards, lower speculative scope, and continued focus on Pilot transactions.

## Consequences

The repository must capture architecture decisions, lessons, and reusable patterns during product delivery. Booking becomes the first case study and conformance suite. Independent Genesis runtime work remains out of scope until repeated product evidence justifies it.

## Validation

Every Sprint 0 governance artifact and future pattern is reviewed against an implemented Booking use case. The Pilot backlog and vertical-slice acceptance tests remain the primary proof that extracted standards are useful.

## References

- `docs/superpowers/specs/2026-08-04-booking-os-pilot-design.md`
- `docs/superpowers/specs/2026-08-04-sprint-0-closeout-design.md`
- `docs/backlog/SPRINT-0.md`
