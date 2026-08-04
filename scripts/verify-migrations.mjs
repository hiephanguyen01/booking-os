import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const migrationDatabaseUrl =
  process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const previousSchemaFixture = resolve(
  repositoryRoot,
  "apps/api/prisma/fixtures/previous-schema.sql",
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

if (!migrationDatabaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required for migration verification.");
}

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
} else {
  console.log("No previous-schema fixture found; upgrade-path verification is not yet applicable.");
}

console.log("Migration verification PASS.");
