# OpenAPI compatibility waivers

Compatibility waivers are narrow, temporary approvals for specific `oasdiff` findings. They are versioned data, not CI labels, environment variables, or a global bypass.

A waiver file must be a direct `*.yaml` child of this directory and conform to `schemas/openapi-compatibility-waiver.schema.json`.

```yaml
id: API-WAIVER-0001
owner: hiephanguyen01
reason: Correct the published response contract before Pilot consumers depend on it.
expiresOn: 2026-08-31
baseContractSha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
revisionContractSha256: fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
findings:
  - severity: ERR
    fingerprint: "ERR exact single-line oasdiff finding"
```

Rules:

- `owner` must identify an accountable person and cannot be `unassigned`.
- `reason` must explain the business or migration need.
- `expiresOn` is a UTC date and must be later than the date on which the check runs. A waiver expires at the start of its listed date.
- Both SHA-256 values must match the exact base and revision contract bytes being compared.
- Every finding must copy the exact severity and exact `oasdiff breaking -f singleline` output.
- A contract edit changes the revision hash and invalidates the old waiver automatically.
- A waiver cannot claim a finding that is absent from the raw report, cannot share the same finding with another active waiver, and cannot broaden into a path-wide or rule-wide ignore.
- Remove the waiver after the consumer migration or contract correction is complete. Do not renew it silently.

No permanent waiver is committed merely to demonstrate this mechanism.
