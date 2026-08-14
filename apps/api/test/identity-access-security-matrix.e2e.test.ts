import { identityAccessTest, runIdentityAccessEvidence } from "./support/identity-access-evidence.js";

identityAccessTest("S1B-AC01 bootstrap provisions the first platform administrator idempotently", () => {
  runIdentityAccessEvidence("S1B-AC01", ["test/platform-admin-bootstrap.integration.test.ts"]);
});

identityAccessTest("S1B-AC02 platform authentication is bound to trusted assignment and exact host", () => {
  runIdentityAccessEvidence("S1B-AC02", [
    "src/modules/sessions/application/use-cases/login.use-case.test.ts",
    "src/modules/sessions/application/use-cases/validate-session.test.ts",
  ]);
});

identityAccessTest("S1B-AC03 platform provisioning creates the tenant and first-owner invitation atomically", () => {
  runIdentityAccessEvidence("S1B-AC03", [
    "test/platform-tenant-provisioning.e2e.test.ts",
    "test/platform-tenant-provisioning-transaction.integration.test.ts",
  ]);
});

identityAccessTest("S1B-AC05 an existing global user joins another tenant without a second identity", () => {
  runIdentityAccessEvidence("S1B-AC05", ["test/membership-invitation.e2e.test.ts"]);
});

identityAccessTest("S1B-AC06 sessions remain host-bound and browser cookies use the host-only contract", () => {
  runIdentityAccessEvidence("S1B-AC06", [
    "src/modules/sessions/application/use-cases/create-session.test.ts",
    "test/session-http.e2e.test.ts",
  ]);
});

identityAccessTest("S1B-AC07 tenant or platform session material cannot replay on the wrong host or scope", () => {
  runIdentityAccessEvidence("S1B-AC07", [
    "src/modules/sessions/application/use-cases/validate-session.test.ts",
    "test/tenant-resolution.e2e.test.ts",
  ]);
});

identityAccessTest("S1B-AC09 password reset is enumeration-safe, single-use, short-lived, and revokes sessions", () => {
  runIdentityAccessEvidence("S1B-AC09", [
    "src/modules/identity/application/use-cases/request-password-reset.test.ts",
    "src/modules/identity/application/use-cases/complete-password-reset.test.ts",
    "src/modules/identity/infrastructure/persistence/prisma/prisma-identity-repository.adapter.test.ts",
  ]);
});

identityAccessTest("S1B-AC11 current authorization is authoritative, current-scope-only, and no-store", () => {
  runIdentityAccessEvidence("S1B-AC11", [
    "test/authorization-endpoint.e2e.test.ts",
    "test/authorization-before-use-case.e2e.test.ts",
  ]);
});

identityAccessTest("S1B-AC13 state-changing browser requests require approved origin and CSRF proof", () => {
  runIdentityAccessEvidence("S1B-AC13", [
    "test/session-http.e2e.test.ts",
    "test/invitation-acceptance.e2e.test.ts",
  ]);
});

identityAccessTest("S1B-AC14 raw secrets stay out of persistence, audit, responses, and outbox payloads", () => {
  runIdentityAccessEvidence("S1B-AC14", [
    "src/modules/sessions/application/use-cases/create-session.test.ts",
    "src/modules/identity/application/use-cases/request-password-reset.test.ts",
    "test/membership-invitation.e2e.test.ts",
    "test/security-audit.e2e.test.ts",
  ]);
});
