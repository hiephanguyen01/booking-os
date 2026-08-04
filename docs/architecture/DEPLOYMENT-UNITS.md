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
