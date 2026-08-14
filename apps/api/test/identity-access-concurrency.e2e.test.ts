import { identityAccessTest, runIdentityAccessEvidence } from "./support/identity-access-evidence.js";

identityAccessTest("S1B-AC04 owner activation and invitation acceptance are atomic under concurrency", () => {
  runIdentityAccessEvidence("S1B-AC04", [
    "test/invitation-acceptance.e2e.test.ts",
    "test/invitation-acceptance-concurrency.e2e.test.ts",
  ]);
});

identityAccessTest("S1B-AC08 session lifetime, rotation, reuse detection, listing, and revocation remain race-safe", () => {
  runIdentityAccessEvidence("S1B-AC08", [
    "src/modules/sessions/application/use-cases/create-session.test.ts",
    "src/modules/sessions/application/use-cases/validate-session.test.ts",
    "src/modules/sessions/application/use-cases/refresh-session.test.ts",
    "src/modules/sessions/infrastructure/http/auth-sessions.controller.test.ts",
    "test/admin-session-revocation.e2e.test.ts",
  ]);
});

identityAccessTest("S1B-AC10 grant boundaries and the final-owner invariant survive concurrent mutations", () => {
  runIdentityAccessEvidence("S1B-AC10", [
    "test/final-owner-invariant.integration.test.ts",
    "test/membership-management.e2e.test.ts",
    "test/permission-declarations.test.ts",
  ]);
});

identityAccessTest("S1B-AC15 the dedicated Sprint 1B acceptance gate is wired before build", () => {
  runIdentityAccessEvidence("S1B-AC15", ["../../scripts/identity-access-gate.test.mjs"]);
});
