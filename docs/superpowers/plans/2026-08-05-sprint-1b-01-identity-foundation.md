# Sprint 1B.1 Identity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish global users, Argon2id credentials, secure one-time activation/reset tokens, encrypted email delivery, and a non-HTTP platform-admin bootstrap path.

**Architecture:** Upgrade `packages/auth` into the framework-neutral identity security library. `apps/api/src/modules/identity` owns use cases through technology-neutral ports; Prisma, Argon2id, HTTP, and envelope encryption are adapters. `worker-critical` decrypts sensitive outbox envelopes only in memory immediately before SMTP submission.

**Tech Stack:** Node.js 22+, TypeScript 5.9, NestJS 11.1, Prisma 6.19, PostgreSQL 17, Argon2id, Node `crypto` AES-256-GCM/HMAC-SHA-256, Nodemailer, Mailpit, Node test runner, Supertest, pnpm 10, Turborepo.

## Global Constraints

- Start from design commit `3154bc74de23016e538ed200db68c3d9c4e10aa1` in a fresh worktree on `feat/sprint-1b-01-identity-foundation`.
- The implementation PR targets `main`; do not merge without explicit user instruction.
- Follow red-green-refactor per task and keep every commit buildable.
- Account creation is admin-provisioned; public signup and self-registration are prohibited.
- `packages/auth` imports no NestJS, Prisma, HTTP, SMTP, Redis, or environment modules.
- Identity domain/application code exposes no Prisma or framework types.
- Email normalization is trim + Unicode NFC + lowercase; preserve dots and plus tags.
- Passwords require at least 12 Unicode code points after NFC. Argon2id baseline: v19, 65536 KiB, time cost 3, parallelism 1, hash length 32, salt length 16.
- Activation TTL is 24 hours; reset TTL is 30 minutes. Reissue atomically revokes prior active tokens for the same purpose, hostname, user, and scope.
- Password reset increments `User.authorizationVersion`, invalidates reset tokens, and revokes all sessions through `SessionRevocationPort`.
- Raw passwords/tokens, email bodies, keys, cookies, and encrypted envelopes never appear in logs, traces, audit payloads, API responses, plaintext columns, or unencrypted outbox JSON.
- Bootstrap is an idempotent CLI/seed only; no HTTP setup route, default password, or long-lived bootstrap secret.
- Local SMTP uses Mailpit; production configuration is fail-fast.

---

### Task 1: Identity Configuration and Local SMTP

**Files:**
- Modify: `apps/api/package.json`, `apps/worker-critical/package.json`, `pnpm-lock.yaml`
- Modify: `apps/api/src/config/environment.schema.ts`, `environment.schema.test.ts`, `environment.service.ts`
- Modify: `apps/api/.env.example`, `apps/worker-critical/.env.example`, `.env.docker.example`, `compose.yaml`
- Modify: `scripts/assert-production-config.mjs`, `scripts/readme-commands.test.mjs`, `README.md`

**Produces:**
```ts
interface IdentitySecurityConfig {
  tokenPepper: string;
  envelopeKeys: Readonly<Record<string, Buffer>>;
  activeEnvelopeKeyId: string;
  bootstrapAdminEmail?: string;
  bootstrapEnabled: boolean;
  smtp: { host: string; port: number; secure: boolean; from: string };
}
```

- [ ] Write tests rejecting missing/malformed token pepper, non-base64 32-byte envelope keys, unknown active key ID, invalid SMTP settings, and bootstrap without email.
- [ ] Run `pnpm --filter @booking-os/api test -- environment.schema.test.ts`; expected FAIL for missing identity configuration.
- [ ] Add `argon2` to API, `nodemailer` plus types to worker, strict environment parsing, and pinned Mailpit service with healthcheck.
- [ ] Rerun the focused test, `pnpm infra:config`, `pnpm verify:production-config`, typecheck, and `pnpm check:ci`; expected PASS.
- [ ] Commit: `chore: add identity security configuration`.

### Task 2: Framework-Neutral Security Primitives

**Files:**
- Create: `packages/auth/src/email-normalization.ts`, `password-policy.ts`, `password-hasher.ts`, `one-time-token.ts`, `sensitive-envelope.ts`
- Modify: `packages/auth/src/index.ts`
- Create exact tests under `packages/auth/tests/` with matching filenames.

**Produces:**
```ts
function normalizeEmail(input: string): string;
interface PasswordHasher { hash(password: string): Promise<string>; verify(hash: string, password: string): Promise<boolean>; needsRehash(hash: string): boolean }
interface OneTimeToken { selector: string; secret: string; serialized: string; secretDigest: string }
function createOneTimeToken(options: { pepper: Uint8Array; randomBytes?: (size: number) => Uint8Array }): OneTimeToken;
interface SensitiveEnvelope { version: 1; keyId: string; iv: string; ciphertext: string; tag: string }
```

- [ ] Write tests for NFC/case/plus-tag behavior, 12-code-point policy, common-password denial, selector/secret entropy, HMAC purpose binding, constant-time verification, AES-GCM round-trip, AAD binding, key rotation, and tamper rejection.
- [ ] Run `pnpm --filter @booking-os/auth test`; expected FAIL for missing exports.
- [ ] Implement pure functions using Node `crypto`; no persistence or framework code.
- [ ] Rerun auth test/typecheck/lint; expected PASS.
- [ ] Commit: `feat: add identity security primitives`.

### Task 3: Global Identity Schema and Seeds

**Files:**
- Modify: `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`
- Create: `apps/api/prisma/migrations/20260805_identity_foundation/migration.sql`
- Create: `apps/api/test/identity-schema.integration.test.ts`
- Modify: `scripts/verify-migrations.mjs`

**Produces:** `User`, `PasswordCredential`, `AccountActivationToken`, `PasswordResetToken`, `Role`, `Permission`, `RolePermission`, `RoleAssignment`, and `SecurityAuditEvent` models.

- [ ] Write integration tests for unique normalized email, valid statuses/scope shape, one credential, single-use token state, platform assignment uniqueness, and absence of raw-token columns.
- [ ] Run `pnpm --filter @booking-os/api test:e2e -- identity-schema.integration.test.ts`; expected FAIL for missing tables.
- [ ] Add additive schema/SQL checks and deterministic seeds for `platform_admin` plus approved platform permissions.
- [ ] Run Prisma validate/deploy/seed, focused test, and migration verification; expected PASS.
- [ ] Commit: `feat: add global identity schema`.

### Task 4: Identity Module Ports and Adapters

**Files:**
- Create domain files: `apps/api/src/modules/identity/domain/user.ts`, `user-status.ts`, `identity-errors.ts`
- Create ports: `clock.port.ts`, `identity-repository.port.ts`, `password-hasher.port.ts`, `password-denylist.port.ts`, `one-time-token.port.ts`, `sensitive-envelope.port.ts`, `security-audit.port.ts`, `session-revocation.port.ts`
- Create adapters: `argon2-password-hasher.adapter.ts`, `hmac-one-time-token.adapter.ts`, `aes-sensitive-envelope.adapter.ts`, `prisma-identity-repository.adapter.ts` and exact matching tests
- Create: `identity.tokens.ts`, `identity.module.ts`
- Modify: `apps/api/src/app.module.ts`, `scripts/architecture/api-module-manifest.mjs`

**Produces:**
```ts
interface IdentityRepositoryPort {
  findUserByNormalizedEmail(email: string): Promise<GlobalUser | null>;
  createPendingUser(input: PendingUserInput): Promise<GlobalUser>;
  storePasswordCredential(input: PasswordCredentialInput): Promise<void>;
  issueActivationToken(input: StoredActivationToken): Promise<void>;
  issuePasswordResetToken(input: StoredResetToken): Promise<void>;
  consumeActivationToken(input: ConsumeActivationInput): Promise<GlobalUser>;
  replacePasswordAndConsumeReset(input: CompleteResetInput): Promise<void>;
}
```

- [ ] Write Argon2 parameter/rehash tests and repository tests for concurrent email creation, reissue revocation, token row locking, hostname/purpose/expiry validation, and atomic password version increment.
- [ ] Run `pnpm --filter @booking-os/api test -- argon2-password-hasher.adapter.test.ts prisma-identity-repository.adapter.test.ts`; expected FAIL.
- [ ] Implement adapters without leaking Prisma types; register `identity` in architecture manifest.
- [ ] Rerun focused tests, typecheck, and `pnpm verify:architecture`; expected PASS.
- [ ] Commit: `feat: add identity application boundary`.

### Task 5: Provisioning, Activation, and Reset Use Cases

**Files:**
- Create use cases and tests: `provision-user`, `complete-activation`, `request-password-reset`, `complete-password-reset`
- Create: `application/ports/identity-outbox.port.ts`
- Create: `infrastructure/persistence/prisma/prisma-identity-outbox.adapter.ts`
- Modify: `apps/api/src/reliability/outbox-event.ts`, `outbox.repository.ts`, `outbox.repository.integration.test.ts`

**Produces:**
```ts
interface ProvisionUserCommand { email: string; hostname: string; scopeType: "platform" | "tenant"; tenantId?: string; invitationId?: string; requestedByUserId: string }
interface CompletePasswordResetCommand { hostname: string; token: string; newPassword: string; requestId: string }
```

- [ ] Write use-case tests for new/existing user neutrality, exact TTL/binding, reissue, transactional encrypted outbox, activation without session, reset enumeration safety, all-session revocation, and concurrent token consumption.
- [ ] Run `pnpm --filter @booking-os/api test -- "apps/api/src/modules/identity/application/use-cases/*.test.ts"`; expected FAIL.
- [ ] Implement transactions. Outbox event `identity.activation.requested.v1` stores only recipient/template/hostname plus `SensitiveEnvelope`.
- [ ] Rerun focused and outbox integration tests; expected PASS.
- [ ] Commit: `feat: add activation and reset workflows`.

### Task 6: Worker-Critical Email Delivery

**Files:**
- Create: `apps/worker-critical/src/identity-email/identity-email-event.ts`, `sensitive-envelope.ts`, `smtp-identity-email.adapter.ts`, `identity-email-dispatcher.ts` and exact tests
- Modify: worker outbox dispatcher/tests, `app.module.ts`, `config/worker-config.ts`, `worker-config.test.ts`

- [ ] Write tests for event version, AAD decryption, SMTP submission, unknown key/template, retry classification, redaction, and zero raw tokens in logs/errors.
- [ ] Run `pnpm --filter @booking-os/worker-critical test -- identity-email-dispatcher.test.ts`; expected FAIL.
- [ ] Implement fragment links (`/activate#token=...`, `/password/reset#token=...`) only after decryption; no tracking or external assets.
- [ ] Rerun worker tests/typecheck and a Mailpit smoke; expected PASS.
- [ ] Commit: `feat: deliver encrypted identity emails`.

### Task 7: Bootstrap CLI and Public Activation/Reset Slice

**Files:**
- Create: `apps/api/src/cli/bootstrap-platform-admin.ts` and test
- Create identity public controller/DTO/tests and `apps/api/test/identity-public.e2e.test.ts`
- Create web pages/forms for `/activate`, `/password/forgot`, `/password/reset`
- Create BFF routes/tests for activation completion and password forgot/reset
- Modify: `apps/web-console/middleware.ts`, `apps/api/src/openapi/openapi-document.test.ts`

**Routes:** `GET /auth/csrf`, `POST /auth/activation/complete`, `POST /auth/password/forgot`, `POST /auth/password/reset`.

- [ ] Write bootstrap tests proving idempotence, one pending platform assignment, one email, second-email refusal, and no HTTP setup route. Write HTTP/BFF tests for neutral responses, no-store/no-referrer, fragment stripping, and same-origin CSRF.
- [ ] Run `pnpm --filter @booking-os/api test -- bootstrap-platform-admin.test.ts identity-public.controller.test.ts`; expected FAIL.
- [ ] Implement CLI and pre-auth CSRF: host-only `__Host-booking_pre_auth_csrf` nonce, 15-minute HMAC proof bound to nonce/hostname/purpose/time bucket, exact Origin, `x-csrf-token`.
- [ ] Run API unit/E2E, web tests, OpenAPI generation/check, architecture, build, and browser E2E; expected PASS.
- [ ] Commit: `feat: expose activation and reset flows`.

## Plan 1 Completion Gate

- [ ] Seven scoped commits exist.
- [ ] `pnpm verify:foundation` passes from a clean database/worktree.
- [ ] Mailpit receives activation/reset email while logs/outbox JSON contain no raw token.
- [ ] Bootstrap is idempotent and has no HTTP route.
- [ ] Activation is single-use/24h; reset is single-use/30m and invokes global session revocation.
- [ ] OpenAPI/generated client and architecture manifest are current.
- [ ] Open a draft PR titled `feat: establish Sprint 1B identity foundation` and stop for review before Plan 2.