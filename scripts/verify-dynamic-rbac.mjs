import { spawnSync } from "node:child_process";

const unitEvidenceFiles = [
  "src/modules/authorization/domain/tenant-rbac/tenant-rbac-grant-policy.test.ts",
  "src/modules/authorization/application/use-cases/tenant-rbac/create-tenant-custom-role.use-case.test.ts",
  "src/modules/authorization/application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.test.ts",
  "src/modules/authorization/application/use-cases/tenant-rbac/archive-tenant-custom-role.use-case.test.ts",
  "src/modules/authorization/application/use-cases/tenant-rbac/grant-membership-custom-role.use-case.test.ts",
  "src/modules/authorization/application/use-cases/tenant-rbac/revoke-membership-custom-role.use-case.test.ts",
  "src/modules/authorization/infrastructure/http/tenant-rbac.controller.test.ts",
  "src/common/security/security-audit-events.test.ts",
];

const acceptanceEvidenceFiles = [
  "test/tenant-rbac-acceptance.e2e.test.ts",
  "test/tenant-rbac-schema.integration.test.ts",
  "test/tenant-rbac-rls.integration.test.ts",
  "test/tenant-rbac-role-concurrency.e2e.test.ts",
  "test/tenant-rbac-assignment-concurrency.e2e.test.ts",
  "test/tenant-rbac-authoritative-context.e2e.test.ts",
  "test/authorization-context-concurrency.e2e.test.ts",
  "test/tenant-rbac-api.e2e.test.ts",
  "test/tenant-rbac-api-isolation.e2e.test.ts",
];

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["exec", "turbo", "run", "build", "--filter=@booking-os/api"]);
run("pnpm", ["--filter", "@booking-os/api", "prisma:migrate:deploy"]);
run("pnpm", [
  "--filter",
  "@booking-os/api",
  "exec",
  "node",
  "--test",
  "--test-concurrency=1",
  "--import",
  "tsx",
  ...unitEvidenceFiles,
]);
run(
  "pnpm",
  [
    "--filter",
    "@booking-os/api",
    "exec",
    "node",
    "--test",
    "--test-concurrency=1",
    "--import",
    "tsx",
    ...acceptanceEvidenceFiles,
  ],
  { ...process.env, DYNAMIC_RBAC_MATRIX: "1" },
);
