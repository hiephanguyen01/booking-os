import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const checkerPath = join(repositoryRoot, "scripts/check-generated.mjs");

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(
    result.status,
    0,
    `command failed: ${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

async function createFixtureRepository() {
  const root = await mkdtemp(join(tmpdir(), "booking-os-generated-check-"));
  const bin = join(root, "bin");
  await mkdir(join(root, "packages/contracts/openapi"), { recursive: true });
  await mkdir(join(root, "packages/api-client/src/generated"), { recursive: true });
  await mkdir(bin, { recursive: true });

  await writeFile(join(root, "packages/contracts/openapi/openapi.json"), "{\"openapi\":\"3.0.0\"}\n");
  await writeFile(join(root, "packages/api-client/src/generated/schema.ts"), "export type Schema = true;\n");
  await writeFile(join(root, "packages/api-client/src/generated/client.ts"), "export type Client = true;\n");
  await writeFile(join(root, "unrelated.txt"), "clean\n");

  const fakePnpm = join(bin, "pnpm");
  await writeFile(
    fakePnpm,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const mode = process.env.FAKE_GENERATE_MODE ?? "clean";
if (process.argv.slice(2).join(" ") !== "api:generate") process.exit(64);
if (mode === "fail") process.exit(7);
if (mode === "stale") appendFileSync("packages/contracts/openapi/openapi.json", "changed\\n");
`,
  );
  await chmod(fakePnpm, 0o755);

  run("git", ["init", "-q"], { cwd: root });
  run("git", ["config", "user.email", "test@example.com"], { cwd: root });
  run("git", ["config", "user.name", "Generated Check Test"], { cwd: root });
  run("git", ["add", "."], { cwd: root });
  run("git", ["commit", "-qm", "fixture"], { cwd: root });

  return { bin, root };
}

function runChecker(root, bin, mode = "clean") {
  return spawnSync(process.execPath, [checkerPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_GENERATE_MODE: mode,
      PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

test("passes when generated files are current", async () => {
  const fixture = await createFixtureRepository();
  try {
    const result = runChecker(fixture.root, fixture.bin);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("fails and lists only declared generated paths when generation changes output", async () => {
  const fixture = await createFixtureRepository();
  try {
    await writeFile(join(fixture.root, "unrelated.txt"), "dirty but unrelated\n");
    const result = runChecker(fixture.root, fixture.bin, "stale");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/contracts\/openapi\/openapi\.json/);
    assert.doesNotMatch(result.stderr, /unrelated\.txt/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("ignores unrelated dirty files", async () => {
  const fixture = await createFixtureRepository();
  try {
    await writeFile(join(fixture.root, "unrelated.txt"), "dirty but unrelated\n");
    const result = runChecker(fixture.root, fixture.bin);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("fails when a declared generated file is missing", async () => {
  const fixture = await createFixtureRepository();
  try {
    await unlink(join(fixture.root, "packages/api-client/src/generated/client.ts"));
    const result = runChecker(fixture.root, fixture.bin);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packages\/api-client\/src\/generated\/client\.ts/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("propagates generator failures", async () => {
  const fixture = await createFixtureRepository();
  try {
    const result = runChecker(fixture.root, fixture.bin, "fail");
    assert.equal(result.status, 7);
    assert.match(result.stderr, /api:generate failed with exit code 7/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});
