# OpenAPI compatibility waivers

Compatibility waivers are narrow, temporary approvals for specific `oasdiff` findings. They are versioned data, not CI labels, environment variables, path-wide rules, or a global bypass.

A waiver file must be a direct `*.yaml` child of this directory and conform to `schemas/openapi-compatibility-waiver.schema.json`.

```yaml
id: API-WAIVER-0001
owner: hiephanguyen01
reason: Correct the published response contract before Pilot consumers depend on it.
expiresOn: 2026-08-31
baseContractSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
revisionContractSha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
findings:
  - severity: ERR
    fingerprint: "error at revision.json, in API GET /api/example removed the success response with the status `200` [response-success-status-removed]."
```

## Creating a waiver

Materialize exactly the contract from the pull request base SHA and compare it with the committed revision:

```bash
BASE_SHA=<pull-request-base-sha>
mkdir -p .tmp/openapi
git show "${BASE_SHA}:packages/contracts/openapi/openapi.json" > .tmp/openapi/base.json

go install github.com/oasdiff/oasdiff@v1.17.0
oasdiff breaking -f singleline --color never \
  .tmp/openapi/base.json \
  packages/contracts/openapi/openapi.json

sha256sum .tmp/openapi/base.json
sha256sum packages/contracts/openapi/openapi.json
```

Copy the complete single-line finding after its summary line. The loader normalizes the tool's `error`/`warning` prefix to waiver severity `ERR`/`WARN`, but the fingerprint remains the exact uncolored output line.

Validate the exact contract pair and all repository fixture cases:

```bash
pnpm api:check-breaking \
  .tmp/openapi/base.json \
  packages/contracts/openapi/openapi.json \
  docs/api/compatibility-waivers

pnpm api:verify-compatibility-fixtures
```

`api:check-breaking` exits with:

- `0` when contracts are compatible or every reported finding is exactly waived.
- `1` when unwaived `ERR` or `WARN` findings remain.
- `2` for invalid contracts, invalid or expired waiver data, hash/severity/fingerprint inconsistencies, missing tools, parse failures, or other configuration errors.

## Rules

- `owner` must identify an accountable person and cannot be `unassigned`.
- `reason` must explain the business or migration need.
- `expiresOn` is a UTC date and must be later than the date on which the check runs. A waiver expires at the start of its listed date.
- Quote both SHA-256 values so YAML preserves them as strings, including hashes containing only digits.
- Both SHA-256 values must match the exact base and revision contract bytes being compared.
- Every finding must use the normalized severity and copy the exact `oasdiff breaking -f singleline` output as its fingerprint.
- A contract edit changes the revision hash and invalidates the old waiver automatically.
- A waiver cannot claim a finding absent from the raw report, use the wrong severity, repeat a finding, share the same finding with another active waiver, or broaden into a path-wide/rule-wide ignore.
- Remove the waiver after the consumer migration or contract correction is complete. Do not renew it silently.

No permanent waiver is committed merely to demonstrate this mechanism; all examples used by CI live under `scripts/openapi/fixtures/waivers/`.
