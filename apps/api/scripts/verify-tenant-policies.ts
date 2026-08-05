import { Pool } from "pg";

import { TENANT_POLICY_MANIFEST } from "../src/modules/tenancy/infrastructure/persistence/tenant-policy-manifest.js";
import { verifyTenantPolicies } from "../src/modules/tenancy/infrastructure/persistence/tenant-policy-verifier.js";

const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error(
    "MIGRATION_DATABASE_URL or DATABASE_URL is required for tenant policy verification.",
  );
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  const failures = await verifyTenantPolicies(pool, TENANT_POLICY_MANIFEST);
  if (failures.length > 0) {
    console.error("Tenant policy verification FAIL:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Tenant policy verification PASS.");
  }
} finally {
  await pool.end();
}
