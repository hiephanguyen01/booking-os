import {
  identityAccessTest,
  runIdentityAccessEvidence,
} from "./support/identity-access-evidence.js";

identityAccessTest(
  "S1B-AC12 tenant identity-access tables enforce FORCE RLS and cross-tenant isolation",
  () => {
    runIdentityAccessEvidence("S1B-AC12", [
      "test/identity-schema.integration.test.ts",
      "test/membership-rls.integration.test.ts",
      "test/session-rls.integration.test.ts",
      "test/tenant-security-audit-rls.integration.test.ts",
      "test/tenant-isolation.e2e.test.ts",
    ]);
  },
);
