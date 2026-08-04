---
id: ADR-0005
title: Transactional Inbox and Outbox Reliability
status: accepted
owner: hiephanguyen01
date: 2026-08-04
---

# Transactional Inbox and Outbox Reliability

## Context

Booking, payment, notification, and finance workflows require reliable asynchronous processing without losing events after a database commit or applying the same external message more than once.

## Problem

Publishing directly to a queue after committing business data creates a failure window where the database succeeds but the event is lost. Processing queue messages without durable idempotency can repeat side effects after retries or worker crashes.

## Options Considered

1. Publish directly to Redis or an external broker after database commits.
2. Use transactional outbox writes and idempotent inbox processing.
3. Introduce distributed transactions across PostgreSQL and the queue.

## Decision

Write business state and outbox records in the same PostgreSQL transaction. Workers claim pending outbox rows using bounded leases and `SKIP LOCKED`, publish or execute the work, and record completion or retry state durably.

Inbound asynchronous work uses an inbox identity to make processing idempotent. Retries use bounded backoff, stale claims can be recovered, terminal failures move to a dead-letter state, and persisted error data is sanitized.

## Trade-offs

The pattern adds tables, polling, claim recovery, retention, and operational monitoring. It avoids distributed transactions and closes the database-to-queue loss window while making duplicate delivery safe.

## Consequences

Every asynchronous side effect that follows a business transaction must originate from the transaction's outbox record. Consumers must define idempotency identities. Operators need visibility into retries, stale claims, and dead-letter records, with audited privileged access for recovery.

## Validation

Foundation tests prove same-transaction outbox creation, concurrent `SKIP LOCKED` claims, retry progression, stale-claim recovery, idempotent inbox behavior, dead-letter transitions, and safe worker shutdown.

## References

- `docs/superpowers/specs/2026-08-04-booking-os-pilot-design.md`
- `docs/superpowers/plans/2026-08-04-booking-os-pilot-foundation.md`
- `docs/runbooks/foundation-recovery.md`
