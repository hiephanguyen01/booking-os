# Deployment Units

The Booking OS Pilot uses exactly five canonical deployment-unit identifiers:

```text
api
web-storefront
web-console
worker-critical
worker-batch
```

These identifiers are frozen for package naming, CI filters, deployment manifests, runbooks, logs, metrics, dashboards, alerts, and architecture records.

Friendly product labels may appear in user interfaces and prose, but they do not replace the canonical identifiers. Renaming or splitting a deployment unit requires an accepted architecture decision because operational tooling and ownership boundaries depend on these names.

## Sprint 1B identity-access placement

Sprint 1B does not add a sixth deployment unit.

- `api` owns authoritative identity, session validation/rotation, memberships, permissions/resource policy, authorization-version reconciliation, security audit, and tenant transaction orchestration.
- `web-console` is the Platform/Tenant browser/BFF surface. It keeps bearer material out of browser storage, preserves the host-only secure-cookie contract, and applies the auth-page security policy.
- `worker-critical` and `worker-batch` do not become authentication authorities. Approved identity email/outbox work executes through the existing reviewed worker boundary.
- `web-storefront` does not gain a separate identity system in Sprint 1B. Later Customer identity extends the shared kernel.

PostgreSQL remains transactional/authorization-adjacent source of truth and final RLS boundary. Redis remains an operational dependency for queues/cache rather than a source of user, membership, role, or authorization truth.
