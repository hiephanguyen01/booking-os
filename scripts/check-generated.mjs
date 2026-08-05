import { spawnSync } from "node:child_process";
import process from "node:process";

const GENERATED_PATHS = [
  "packages/contracts/openapi/openapi.json",
  "packages/api-client/src/generated/schema.ts",
  "packages/api-client/src/generated/client.ts",
];

function run(command, args) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
}

function writeCapturedOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function fail(message, exitCode) {
  process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
}

function main() {
  const generation = run("pnpm", ["api:generate"]);
  writeCapturedOutput(generation);

  if (generation.error !== undefined) {
    fail(`api:generate could not start: ${generation.error.message}`, 2);
    return;
  }
  if (generation.status !== 0) {
    fail(`api:generate failed with exit code ${generation.status ?? 2}`, generation.status ?? 2);
    return;
  }

  const status = run("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...GENERATED_PATHS,
  ]);
  if (status.error !== undefined) {
    fail(`git status could not start: ${status.error.message}`, 2);
    return;
  }
  if (status.status !== 0) {
    writeCapturedOutput(status);
    fail(`git status failed with exit code ${status.status ?? 2}`, 2);
    return;
  }

  const drift = status.stdout.trim();
  if (drift !== "") {
    fail(
      `Generated artifacts are stale:\n${drift}\nRun pnpm api:generate and commit the result.`,
      1,
    );
    return;
  }

  process.stdout.write("Generated artifacts are current.\n");
}

main();