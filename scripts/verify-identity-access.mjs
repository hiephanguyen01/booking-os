import { spawnSync } from "node:child_process";

const matrixFiles = [
  "test/identity-access-security-matrix.e2e.test.ts",
  "test/identity-access-rls-matrix.e2e.test.ts",
  "test/identity-access-concurrency.e2e.test.ts",
];

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("pnpm", ["exec", "turbo", "run", "build", "--filter=@booking-os/api"]);
run("pnpm", ["--filter", "@booking-os/api", "prisma:migrate:deploy"]);
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
    ...matrixFiles,
  ],
  { ...process.env, IDENTITY_ACCESS_MATRIX: "1" },
);
