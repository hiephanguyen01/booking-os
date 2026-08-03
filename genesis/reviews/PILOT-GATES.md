# Pilot Quality Gates

## Tenant and Security

- [ ] Tenant A cannot read/write Tenant B through API, DB, cache, export, search or worker.
- [ ] Permissions, membership, entitlement and resource ownership are enforced server-side.
- [ ] Every tenant-owned table has FORCE RLS and isolation tests.
- [ ] Session, CSRF, CORS, rate limit and secret scanning pass.

## Booking and Availability

- [ ] Concurrent requests cannot exceed resource capacity.
- [ ] Expired holds do not remain as confirmed occupancy.
- [ ] State transitions are valid, idempotent and have history.
- [ ] Buffer, block, exception, lead time and timezone are correct.

## Payment and Finance

- [ ] Duplicate/out-of-order/late webhooks do not duplicate payment, booking, journal or notification.
- [ ] Booking confirmation is based on verified webhook/reconciliation, not return URL.
- [ ] Ledger entries balance.
- [ ] Refund and payout do not exceed eligible amounts.
- [ ] Reconciliation identifies discrepancies.

## Operations

- [ ] Health/readiness endpoints work.
- [ ] Backup restore has been tested.
- [ ] Critical queues have monitoring and dead-letter handling.
- [ ] Refund, payout and incident runbooks have owners.
