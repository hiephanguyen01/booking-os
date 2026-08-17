import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const migrationDatabaseUrl =
  process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const previousSchemaFixture = resolve(
  repositoryRoot,
  "apps/api/prisma/fixtures/previous-schema.sql",
);
const identityMigrationPath = resolve(
  repositoryRoot,
  "apps/api/prisma/migrations/20260805_identity_foundation/migration.sql",
);
const dynamicRbacMigrationPath = resolve(
  repositoryRoot,
  "apps/api/prisma/migrations/20260816_tenant_dynamic_rbac/migration.sql",
);

function run(args, environment = {}) {
  const result = spawnSync("pnpm", args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${String(result.status)}: pnpm ${args.join(" ")}`,
    );
  }
}

function verifyIdentityMigrationContract() {
  if (!existsSync(identityMigrationPath)) {
    throw new Error(`Missing identity migration: ${identityMigrationPath}`);
  }

  const migration = readFileSync(identityMigrationPath, "utf8");
  const requiredSnippets = [
    'CREATE TABLE "users"',
    'CREATE TABLE "password_credentials"',
    'CREATE TABLE "account_activation_tokens"',
    'CREATE TABLE "password_reset_tokens"',
    'CREATE TABLE "roles"',
    'CREATE TABLE "permissions"',
    'CREATE TABLE "role_permissions"',
    'CREATE TABLE "role_assignments"',
    'CREATE TABLE "security_audit_events"',
    '"account_activation_tokens_one_active_scope_key"',
    '"password_reset_tokens_one_active_scope_key"',
    "NULLS NOT DISTINCT",
    "platform.security.audit.read",
    "platform.tenants.provision",
    "platform.users.provision",
  ];

  for (const snippet of requiredSnippets) {
    if (!migration.includes(snippet)) {
      throw new Error(`Identity migration is missing required contract: ${snippet}`);
    }
  }

  const forbiddenPlaintextColumns = [
    /"(?:raw_)?password"\s/i,
    /"(?:raw_)?token"\s/i,
    /"secret"\s/i,
  ];

  for (const pattern of forbiddenPlaintextColumns) {
    if (pattern.test(migration)) {
      throw new Error(`Identity migration contains a forbidden plaintext column: ${pattern}`);
    }
  }
}

function verifyDynamicRbacMigrationContract() {
  if (!existsSync(dynamicRbacMigrationPath)) {
    throw new Error(`Missing tenant dynamic RBAC migration: ${dynamicRbacMigrationPath}`);
  }

  const migration = readFileSync(dynamicRbacMigrationPath, "utf8");
  const requiredSnippets = [
    'CREATE TABLE "tenant_custom_roles"',
    'CREATE TABLE "tenant_custom_role_permissions"',
    'CREATE TABLE "tenant_custom_role_assignments"',
    '"tenant_memberships_id_tenant_id_key" UNIQUE ("id", "tenant_id")',
    '"tenant_custom_roles_active_name_key"',
    '"tenant_custom_role_assignments_active_key"',
    '"tenant_custom_role_permissions_role_tenant_fkey"',
    '"tenant_custom_role_assignments_role_tenant_fkey"',
    '"tenant_custom_role_assignments_membership_tenant_fkey"',
    "validate_tenant_custom_role_permission",
    "validate_tenant_custom_role_assignment",
    'ALTER TABLE "tenant_custom_roles" FORCE ROW LEVEL SECURITY',
    'ALTER TABLE "tenant_custom_role_permissions" FORCE ROW LEVEL SECURITY',
    'ALTER TABLE "tenant_custom_role_assignments" FORCE ROW LEVEL SECURITY',
    '"tenant_custom_roles_tenant_isolation"',
    '"tenant_custom_role_permissions_tenant_isolation"',
    '"tenant_custom_role_assignments_tenant_isolation"',
    "app.tenant_id",
    "tenant.rbac.role.create",
    "tenant.rbac.assignment.revoke",
  ];

  for (const snippet of requiredSnippets) {
    if (!migration.includes(snippet)) {
      throw new Error(`Tenant dynamic RBAC migration is missing required contract: ${snippet}`);
    }
  }
}

if (!migrationDatabaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required for migration verification.");
}

verifyIdentityMigrationContract();
verifyDynamicRbacMigrationContract();

const migrationEnvironment = { DATABASE_URL: migrationDatabaseUrl };

run(["--filter", "@booking-os/api", "prisma:validate"], migrationEnvironment);
run(["--filter", "@booking-os/api", "prisma:migrate:deploy"], migrationEnvironment);
run(
  [
    "--filter",
    "@booking-os/api",
    "exec",
    "prisma",
    "migrate",
    "status",
    "--schema",
    "prisma/schema.prisma",
  ],
  migrationEnvironment,
);
run(
  [
    "--filter",
    "@booking-os/api",
    "exec",
    "prisma",
    "migrate",
    "diff",
    "--from-url",
    migrationDatabaseUrl,
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--exit-code",
  ],
  migrationEnvironment,
);
run(["--filter", "@booking-os/api", "verify:tenant-policies"], migrationEnvironment);

if (existsSync(previousSchemaFixture)) {
  const previousSchemaDatabaseUrl = process.env.PREVIOUS_SCHEMA_DATABASE_URL?.trim();

  if (!previousSchemaDatabaseUrl) {
    throw new Error(
      "PREVIOUS_SCHEMA_DATABASE_URL is required when the previous-schema fixture exists.",
    );
  }

  run(
    [
      "--filter",
      "@booking-os/api",
      "exec",
      "prisma",
      "db",
      "execute",
      "--file",
      "prisma/fixtures/previous-schema.sql",
      "--url",
      previousSchemaDatabaseUrl,
    ],
    { DATABASE_URL: previousSchemaDatabaseUrl },
  );
  run(["--filter", "@booking-os/api", "prisma:migrate:deploy"], {
    DATABASE_URL: previousSchemaDatabaseUrl,
  });
  run(
    [
      "--filter",
      "@booking-os/api",
      "exec",
      "prisma",
      "migrate",
      "status",
      "--schema",
      "prisma/schema.prisma",
    ],
    { DATABASE_URL: previousSchemaDatabaseUrl },
  );
  run(["--filter", "@booking-os/api", "verify:tenant-policies"], {
    DATABASE_URL: previousSchemaDatabaseUrl,
  });
} else {
  console.log("No previous-schema fixture found; upgrade-path verification is not yet applicable.");
}

console.log("Migration verification PASS.");
