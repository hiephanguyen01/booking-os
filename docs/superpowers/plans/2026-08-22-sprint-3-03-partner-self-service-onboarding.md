# Sprint 3.3 Partner Self-Service Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated Partner complete individual/company profile data, private verification evidence, masked/encrypted payout data, and submit a review-frozen application while remaining operationally inactive.

**Architecture:** Partner self-service use cases run inside the tenant transaction and derive Partner identity from the authoritative Partner session. Profile, verification, evidence, and payout persistence is tenant-owned and FORCE-RLS protected. Evidence uses a dedicated private object-storage bucket and short-lived upload/download capabilities; payout account numbers use the existing authenticated-encryption envelope through an exported application-facing contract. `submitted` freezes review material until Tenant review moves the application to `changes_requested`.

**Tech Stack:** Node.js >=22 <25, pnpm >=10 <11, TypeScript 5.9.3, NestJS 11.1.28, Prisma 6.19.3, PostgreSQL 17 FORCE RLS, MinIO/S3-compatible object storage, Node test runner, Supertest, existing `SensitiveEnvelopePort`, OpenAPI generation/client tooling.

**Spec:** `docs/superpowers/specs/2026-08-22-sprint-3-partner-foundation-onboarding-design.md`

## Global Constraints

- Plans 3.1 and 3.2 completion gates must be GREEN before this plan begins.
- `/partner/me/*` derives Partner identity from the authenticated session; DTOs do not accept authoritative `tenantId` or `partnerId`.
- Only `draft` and `changes_requested` applications are editable by Partner self-service.
- `submitted`, `approved`, and `rejected` application material cannot be silently rewritten by normal self-service mutations.
- `individual` and `company` have different required verification/completeness rules; encode them as explicit domain policy, not scattered controller conditions.
- Evidence storage is private. Browser-controlled object keys, permanent public URLs, and sensitive values in object paths are forbidden.
- Evidence replacement supersedes old records; object key/checksum/uploader provenance is immutable.
- Payout account number is encrypted at rest and masked on normal reads; raw account numbers never appear in audit, metrics, generic DTOs, logs, or database JSON.
- Payout replacement creates a new record and supersedes the old active record.
- Malware/safety state is explicit. Evidence is not reviewer-consumable until state is `clean`.
- Do not implement listing/resource/catalog entities in this plan.
- Use PostgreSQL race tests for edit-vs-submit and evidence/payout-vs-submit behavior.

---

## File Structure

- `apps/api/prisma/schema.prisma` — Partner profile, verification item, evidence, payout account tables/enums.
- `apps/api/prisma/migrations/<timestamp>_partner_onboarding_material/migration.sql` — tables, RLS, composite FKs, immutability/superseding constraints, exact DML.
- `apps/api/src/modules/partners/domain/partner-onboarding-policy.ts` — required fields/verification kinds by Partner type and submit completeness.
- `apps/api/src/modules/partners/application/ports/partner-profile-repository.port.ts` — profile persistence.
- `apps/api/src/modules/partners/application/ports/partner-verification-repository.port.ts` — verification state persistence.
- `apps/api/src/modules/partners/application/ports/partner-evidence-repository.port.ts` — evidence metadata persistence.
- `apps/api/src/modules/partners/application/ports/partner-evidence-object-store.port.ts` — short-lived object capability contract.
- `apps/api/src/modules/partners/application/ports/partner-payout-account-repository.port.ts` — encrypted payout record persistence.
- `apps/api/src/modules/partners/application/use-cases/*` — profile/evidence/payout/application self-service orchestration.
- `apps/api/src/modules/partners/infrastructure/persistence/prisma/*` — transaction-bound adapters.
- `apps/api/src/modules/partners/infrastructure/object-storage/s3-partner-evidence-object-store.adapter.ts` — MinIO/S3 adapter.
- `apps/api/src/modules/partners/infrastructure/http/partner-self-service.controller.ts` — `/partner/me/*` boundary.
- `apps/api/src/modules/partners/infrastructure/http/partner-self-service.dto.ts` — public DTOs.
- `apps/api/src/modules/identity/identity.module.ts` — export the existing sensitive-envelope implementation token/contract if not already exportable.
- `apps/api/package.json`, `pnpm-lock.yaml` — add S3 client/presigner only for this production adapter.
- `infra/minio/create-buckets.sh`, `.env.docker.example`, `compose.yaml` — dedicated private Partner evidence bucket configuration.
- `apps/api/test/partner-onboarding-material-rls.integration.test.ts` — RLS/FK/DML evidence.
- `apps/api/test/partner-onboarding-concurrency.e2e.test.ts` — edit/evidence/payout vs submit races.
- `apps/api/test/partner-self-service-api.e2e.test.ts` — Partner A/B and state/security API evidence.

### Task 1: Add onboarding material tables with FORCE RLS, superseding history, and exact DML

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_partner_onboarding_material/migration.sql`
- Modify: `apps/api/src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.ts`
- Test: `apps/api/test/partner-onboarding-material-rls.integration.test.ts`

**Interfaces:**
- Consumes: `partners(id, tenant_id)` and PartnerMembership from Plan 3.1.
- Produces: `partner_profiles`, `partner_verification_items`, `partner_evidence`, `partner_payout_accounts`.

- [ ] **Step 1: Write RED database tests**

Assert same-tenant composite FKs, one active payout account, immutable evidence provenance, RLS, and minimum DML:

```ts
assert.equal(await isForceRls("partner_profiles"), true);
assert.equal(await isForceRls("partner_evidence"), true);
assert.equal(await isForceRls("partner_payout_accounts"), true);
assert.deepEqual(await privilegesFor("partner_evidence", "booking_app"), ["INSERT", "SELECT", "UPDATE"]);
```

Direct DML must reject changing evidence `object_key`, `sha256`, `uploaded_by_membership_id`, `partner_id`, or `tenant_id` after insert.

- [ ] **Step 2: Prove RED**

```bash
node --test --test-concurrency=1 --import tsx apps/api/test/partner-onboarding-material-rls.integration.test.ts
```

Expected: FAIL because tables do not exist.

- [ ] **Step 3: Add explicit Prisma enums/models**

Use:

```prisma
enum PartnerVerificationKind {
  identity
  businessRegistration @map("business_registration")
  payoutAccount @map("payout_account")
  managementRights @map("management_rights")
}

enum PartnerVerificationStatus {
  pending
  verified
  changesRequired @map("changes_required")
  rejected
}

enum PartnerEvidenceSafetyStatus {
  pendingScan @map("pending_scan")
  clean
  quarantined
}
```

`PartnerProfile` stores structured business/profile fields, not arbitrary JSON for identity-critical fields. `PartnerVerificationItem` is unique on `(tenant_id, partner_id, kind)`. `PartnerEvidence` includes `objectKey`, `contentType`, `sizeBytes`, `sha256`, uploader, safety state, and `supersededAt`. `PartnerPayoutAccount` stores bank code, holder name, envelope fields, last4, fingerprint, verification state, version, and `supersededAt`.

- [ ] **Step 4: Add SQL structural guards**

Evidence identity/provenance trigger:

```sql
IF OLD."tenant_id" IS DISTINCT FROM NEW."tenant_id"
   OR OLD."partner_id" IS DISTINCT FROM NEW."partner_id"
   OR OLD."object_key" IS DISTINCT FROM NEW."object_key"
   OR OLD."sha256" IS DISTINCT FROM NEW."sha256"
   OR OLD."uploaded_by_membership_id" IS DISTINCT FROM NEW."uploaded_by_membership_id" THEN
  RAISE EXCEPTION 'partner evidence provenance cannot be modified' USING ERRCODE = '23514';
END IF;
```

Create a partial unique index for the active payout account:

```sql
CREATE UNIQUE INDEX "partner_payout_accounts_active_key"
ON "partner_payout_accounts" ("tenant_id", "partner_id")
WHERE "superseded_at" IS NULL;
```

- [ ] **Step 5: Enable/FORCE RLS and exact grants for every new table**

All four tables use canonical `app.tenant_id`. Grant `SELECT, INSERT, UPDATE`; no DELETE. Add exact manifest entries.

- [ ] **Step 6: Run GREEN DB gates and commit**

```bash
pnpm --filter @booking-os/api prisma:validate
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm verify:migrations
pnpm --filter @booking-os/api test:e2e
```

```bash
git add apps/api/prisma apps/api/src/modules/tenancy apps/api/test/partner-onboarding-material-rls.integration.test.ts
git commit -m "feat: add partner onboarding persistence"
```

### Task 2: Implement Partner-type completeness policy and profile self-service

**Files:**
- Create: `apps/api/src/modules/partners/domain/partner-onboarding-policy.ts`
- Create: `apps/api/src/modules/partners/domain/partner-onboarding-policy.test.ts`
- Create: `apps/api/src/modules/partners/application/ports/partner-profile-repository.port.ts`
- Create: `apps/api/src/modules/partners/application/ports/partner-verification-repository.port.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/get-partner-self.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/update-partner-profile.ts`
- Create matching unit tests.
- Create/modify Prisma adapters under `apps/api/src/modules/partners/infrastructure/persistence/prisma/`.

**Interfaces:**
- Consumes: Partner authoritative context and `canEditApplication()` from Plan 3.1.
- Produces: explicit profile/verification policy used by submit and Tenant review.

- [ ] **Step 1: Write RED policy tests**

```ts
assert.deepEqual(requiredVerificationKinds("individual"), [
  "identity",
  "payout_account",
  "management_rights",
]);
assert.deepEqual(requiredVerificationKinds("company"), [
  "identity",
  "business_registration",
  "payout_account",
  "management_rights",
]);
```

Assert submitted Partner profile edits reject with `PARTNER_APPLICATION_INVALID_STATE`.

- [ ] **Step 2: Prove RED**

```bash
node --test --import tsx apps/api/src/modules/partners/domain/partner-onboarding-policy.test.ts
```

- [ ] **Step 3: Implement profile policy and repository ports**

Use typed policy functions rather than controller branching:

```ts
export function requiredVerificationKinds(type: PartnerType): readonly PartnerVerificationKind[] {
  return type === "company"
    ? ["identity", "business_registration", "payout_account", "management_rights"]
    : ["identity", "payout_account", "management_rights"];
}
```

`UpdatePartnerProfile` must lock the Partner root first, assert editable state, then upsert only the current Partner's profile inside the same tenant transaction.

- [ ] **Step 4: Prove Partner A cannot mutate Partner B through repository/use-case paths**

The use case accepts no Partner ID from DTO input; it receives Partner ID only from `PartnerAuthorizationContext`.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @booking-os/api test
pnpm verify:architecture
pnpm typecheck
```

```bash
git add apps/api/src/modules/partners
git commit -m "feat: add partner profile self service"
```

### Task 3: Implement encrypted/masked payout-account replacement

**Files:**
- Create: `apps/api/src/modules/partners/application/ports/partner-payout-account-repository.port.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/get-partner-payout-account.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/set-partner-payout-account.ts`
- Create matching tests.
- Create: `apps/api/src/modules/partners/infrastructure/persistence/prisma/prisma-partner-payout-account-repository.adapter.ts`
- Modify: `apps/api/src/modules/identity/identity.module.ts` only to export the existing sensitive-envelope contract/token if required.

**Interfaces:**
- Consumes: existing `SensitiveEnvelopePort.seal/open`, Partner transaction, editable-state rule.
- Produces: masked payout DTO and append/supersede payout persistence.

- [ ] **Step 1: Write RED tests proving raw data never leaves the use case**

```ts
const result = await setPayout.execute(context, {
  bankCode: "VCB",
  accountHolderName: "NGUYEN VAN A",
  accountNumber: "1234567890",
});
assert.equal(result.accountNumberMasked, "******7890");
assert.equal("accountNumber" in result, false);
assert.equal(JSON.stringify(auditEvents).includes("1234567890"), false);
```

- [ ] **Step 2: Prove RED**

```bash
node --test --import tsx apps/api/src/modules/partners/application/use-cases/set-partner-payout-account.test.ts
```

- [ ] **Step 3: Seal with tenant/Partner-bound associated data**

```ts
const aad = new TextEncoder().encode(`partner-payout:${tenantId}:${partnerId}`);
const envelope = sensitiveEnvelope.seal(new TextEncoder().encode(accountNumber), aad);
```

Persist envelope version/key/iv/ciphertext/tag as dedicated columns, plus `last4` and a keyed non-reversible fingerprint used only for equality checks.

- [ ] **Step 4: Replace by superseding, never ciphertext overwrite**

Lock Partner root -> assert editable state -> lock current active payout -> set `superseded_at` -> insert new active payout -> update payout verification item to `pending` -> audit safe metadata only.

- [ ] **Step 5: Run GREEN checks and commit**

```bash
pnpm --filter @booking-os/api test
pnpm --filter @booking-os/api test:e2e
```

```bash
git add apps/api/src/modules/partners apps/api/src/modules/identity
git commit -m "feat: secure partner payout accounts"
```

### Task 4: Add private Partner evidence object storage and finalize flow

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `infra/minio/create-buckets.sh`
- Modify: `.env.docker.example`
- Modify: `compose.yaml`
- Create: `apps/api/src/modules/partners/application/ports/partner-evidence-repository.port.ts`
- Create: `apps/api/src/modules/partners/application/ports/partner-evidence-object-store.port.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/create-evidence-upload-intent.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/finalize-partner-evidence.ts`
- Create matching tests.
- Create: `apps/api/src/modules/partners/infrastructure/object-storage/s3-partner-evidence-object-store.adapter.ts`
- Create: `apps/api/src/modules/partners/infrastructure/persistence/prisma/prisma-partner-evidence-repository.adapter.ts`

**Interfaces:**
- Consumes: Partner session context, editable-state rule, MinIO/S3-compatible private storage.
- Produces: short-lived upload capability and immutable finalized evidence metadata.

- [ ] **Step 1: Add production S3-compatible dependencies and a dedicated private bucket**

```bash
pnpm --filter @booking-os/api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Add `MINIO_PARTNER_EVIDENCE_BUCKET=booking-partner-evidence` to Docker env examples. Update bucket initialization to create both the existing default bucket and Partner evidence bucket and run `mc anonymous set none` on both.

- [ ] **Step 2: Write RED object-key and authorization tests**

Generated key format:

```text
partner-evidence/<tenant-uuid>/<partner-uuid>/<random-uuid>
```

Assert caller-supplied filename/email/company/account number cannot become the key. Reject unsupported MIME and size before issuing an upload capability.

- [ ] **Step 3: Define the storage port**

```ts
export interface PartnerEvidenceObjectStorePort {
  createUploadCapability(input: {
    objectKey: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<{ readonly uploadUrl: string; readonly requiredHeaders: Readonly<Record<string, string>> }>;
  statObject(objectKey: string): Promise<{ readonly sizeBytes: number; readonly contentType: string; readonly sha256: string } | null>;
  createDownloadCapability(objectKey: string, expiresInSeconds: number): Promise<{ readonly downloadUrl: string }>;
}
```

- [ ] **Step 4: Implement upload intent/finalize**

`CreateEvidenceUploadIntent`: lock/read Partner -> assert editable -> validate kind/MIME/size -> server-generate key -> return short-lived capability.

`FinalizePartnerEvidence`: stat server-known key -> verify size/MIME/checksum -> insert evidence with `pending_scan` -> supersede previous active evidence for same verification kind -> set verification item `pending`.

Do not mark evidence `clean` merely because upload succeeded. For Pilot, provide a controlled scanner adapter/test hook that transitions `pending_scan -> clean|quarantined`; reviewer APIs in Plan 3.4 accept only `clean` evidence.

- [ ] **Step 5: Run GREEN storage/config tests and commit**

```bash
pnpm infra:config
pnpm --filter @booking-os/api test
pnpm verify:production-config
```

```bash
git add apps/api/package.json pnpm-lock.yaml infra/minio .env.docker.example compose.yaml apps/api/src/modules/partners
git commit -m "feat: add private partner evidence storage"
```

### Task 5: Implement submit completeness, review freeze, and concurrency serialization

**Files:**
- Create: `apps/api/src/modules/partners/application/use-cases/get-partner-application.ts`
- Create: `apps/api/src/modules/partners/application/use-cases/submit-partner-application.ts`
- Create matching tests.
- Test: `apps/api/test/partner-onboarding-concurrency.e2e.test.ts`
- Modify: Partner repositories only where locking operations are required.

**Interfaces:**
- Consumes: completeness policy, profile, verification items, active payout, clean evidence, Partner `expectedVersion`.
- Produces: deterministic `draft|changes_requested -> submitted` transition and frozen review material.

- [ ] **Step 1: Write RED completeness tests**

Company submit must fail without business registration; individual submit must not require it. Both must fail without active payout metadata and required evidence records.

```ts
await assert.rejects(
  () => submit.execute(context, { expectedVersion: 3 }),
  PartnerApplicationIncompleteError,
);
```

- [ ] **Step 2: Write RED PostgreSQL races**

Controlled races:

```text
profile edit vs submit
payout replace vs submit
evidence finalize vs submit
```

All must serialize by locking Partner root first. A committed submit means no concurrent material mutation can commit against the submitted version.

- [ ] **Step 3: Implement submit lock order and transition**

```text
Partner FOR UPDATE
-> expectedVersion check
-> assert draft|changes_requested
-> read/lock profile
-> read required verification/evidence set in deterministic kind/id order
-> read active payout
-> validate completeness
-> application_status = submitted
-> submitted_at = now
-> version += 1
-> append status/audit/outbox
-> commit
```

- [ ] **Step 4: Reject normal material mutations while submitted**

Profile/payout/evidence use cases all lock Partner first and use the same `canEditApplication()` domain rule. Do not rely on stale controller-side state.

- [ ] **Step 5: Run GREEN concurrency suite and commit**

```bash
node --test --test-concurrency=1 --import tsx apps/api/test/partner-onboarding-concurrency.e2e.test.ts
pnpm --filter @booking-os/api test
```

```bash
git add apps/api/src/modules/partners apps/api/test/partner-onboarding-concurrency.e2e.test.ts
git commit -m "feat: submit partner applications"
```

### Task 6: Expose `/partner/me/*` HTTP/OpenAPI self-service contract

**Files:**
- Create: `apps/api/src/modules/partners/infrastructure/http/partner-self-service.controller.ts`
- Create: `apps/api/src/modules/partners/infrastructure/http/partner-self-service.dto.ts`
- Create: `apps/api/src/modules/partners/infrastructure/http/partner-self-service.controller.test.ts`
- Modify: `apps/api/src/modules/partners/partners.module.ts`
- Create: `apps/api/src/openapi/partner-self-service-openapi.contract.test.ts`
- Generate: `packages/contracts/openapi/openapi.json`
- Generate: `packages/api-client/src/generated/schema.ts`
- Generate: `packages/api-client/src/generated/client.ts`
- Test: `apps/api/test/partner-self-service-api.e2e.test.ts`

**Interfaces:**
- Consumes: Plan 3.3 self-service use cases and Partner permission guard.
- Produces: generated Partner self-service API contract.

- [ ] **Step 1: Write RED API tests**

Routes:

```text
GET    /api/partner/me
PATCH  /api/partner/me/profile
GET    /api/partner/me/application
POST   /api/partner/me/application/submit
GET    /api/partner/me/verification
POST   /api/partner/me/evidence/upload-intent
POST   /api/partner/me/evidence/finalize
GET    /api/partner/me/payout-account
PUT    /api/partner/me/payout-account
```

Unsafe routes require valid Partner session + approved Origin + CSRF. Partner A session must never access Partner B by manipulating payload IDs because those IDs are absent from authority DTOs.

- [ ] **Step 2: Implement stable safe response DTOs**

Payout read returns only:

```ts
{
  bankCode,
  accountHolderName,
  accountNumberMasked,
  verificationStatus,
  version,
}
```

Evidence responses return metadata/status, never permanent bucket URLs.

- [ ] **Step 3: Map stable errors**

Use:

```text
PARTNER_APPLICATION_INVALID_STATE
PARTNER_APPLICATION_INCOMPLETE
PARTNER_VERSION_CONFLICT
PARTNER_OPERATION_FORBIDDEN
PARTNER_EVIDENCE_INVALID
PARTNER_EVIDENCE_NOT_SAFE
```

- [ ] **Step 4: Generate/check contracts and run E2E**

```bash
pnpm api:generate
pnpm api:check-generated
pnpm api:check-breaking
pnpm --filter @booking-os/api test:e2e
pnpm build
```

- [ ] **Step 5: Commit Task 6**

```bash
git add apps/api/src/modules/partners apps/api/src/openapi apps/api/test/partner-self-service-api.e2e.test.ts packages/contracts/openapi packages/api-client
git commit -m "feat: expose partner onboarding self service"
```

## Plan 3.3 Completion Gate

- [ ] Individual/company completeness policies are explicit and unit tested.
- [ ] Partner self-service authority derives only from the Partner session.
- [ ] Profile/evidence/payout tables are tenant-owned, composite-FK constrained, FORCE-RLS protected, and exact-DML verified.
- [ ] Payout account numbers are encrypted with tenant+Partner associated data, masked on reads, and absent from audit/logs/metrics.
- [ ] Payout replacement supersedes old records instead of rewriting history.
- [ ] Evidence uses a dedicated private bucket, opaque server-generated keys, bounded MIME/size, checksum verification, and explicit safety state.
- [ ] Evidence provenance is immutable and replacement supersedes historical records.
- [ ] Submit validates complete material under Partner-root locking and freezes normal self-service material mutation.
- [ ] Edit/payout/evidence vs submit PostgreSQL races converge deterministically.
- [ ] `/partner/me/*` HTTP/OpenAPI/generated client is additive, CSRF/origin safe, and same-Partner scoped.
- [ ] Partner remains operationally inactive after submit; no listing/catalog behavior exists.
