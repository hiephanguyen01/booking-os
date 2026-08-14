# Pilot Quality Gates

## Tenant and Security

- [ ] Tenant A cannot read/write Tenant B through API, DB, cache, export, search or worker.
- [ ] Permissions, membership, entitlement and resource ownership are enforced server-side.
- [ ] Every tenant-owned table has FORCE RLS and isolation tests.
- [ ] Session, CSRF, CORS, rate limit and secret scanning pass.

### Sprint 1B identity-access checkpoint

These checks close only the Sprint 1B Platform/Tenant identity-access slice; they do not mark the broader Pilot Tenant/Security gates above complete for future Partner/Customer/product scopes.

- [x] Global identity, host-bound opaque sessions, tenant membership, authoritative permission/resource policy, authorization-version reconciliation, and final-owner concurrency behavior are covered by `S1B-AC01`–`S1B-AC15`.
- [x] Tenant identity-access persistence uses FORCE RLS and dedicated cross-tenant matrix coverage through the normal application role.
- [x] Browser identity acceptance covers one-time fragment scrubbing, host-only session cookie behavior, CSRF/Origin policy, no-store/redirect/security-header invariants, and raw-secret leakage regressions.
- [x] Transactional security audit, bounded metrics, dependency audit, and committed-secret scanning are protected gates.
- [x] Identity-access recovery and first Platform-administrator bootstrap procedures have explicit owners and reviewed runbooks.

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
