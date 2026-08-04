import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { sha256File } from "./waiver-loader.mjs";

const RUNNER = resolve("scripts/openapi/check-breaking.mjs");
const COMPATIBLE_BASE = resolve("scripts/openapi/fixtures/compatible-base.json");
const COMPATIBLE_REVISION = resolve("scripts/openapi/fixtures/compatible-revision.json");
const BREAKING_BASE = resolve("scripts/openapi/fixtures/breaking-base.json");
const BREAKING_REVISION = resolve("scripts/openapi/fixtures/breaking-revision.json");
const TODAY = "2026-08-04";
const ERROR_FINDING = "ERR GET /api/example removed the success response with the status '200'";
const WARNING_FINDING = "WARN GET /api/example removed the response property 'name'";

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "booking-os-compatibility-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createFakeOasdiff(directory) {
  const path = join(directory, "oasdiff");
  await writeFile(
    path,
    `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const ERROR_FINDING = ${JSON.stringify(ERROR_FINDING)};
const WARNING_FINDING = ${JSON.stringify(WARNING_FINDING)};
const args = process.argv.slice(2);
const mode = process.env.FAKE_OASDIFF_MODE ?? "normal";
if (mode === "unexpected-exit") process.exit(9);
if (args[0] !== "breaking") process.exit(7);
const raw = args[1] === "-f" && args[2] === "singleline";
if (raw) {
  if (mode === "unparseable") {
    console.log("finding without a severity prefix");
    process.exit(0);
  }
  if (args.at(-1).includes("compatible-revision")) process.exit(0);
  console.log(ERROR_FINDING);
  console.log(WARNING_FINDING);
  process.exit(0);
}
function ignored(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return new Set();
  return new Set(readFileSync(args[index + 1], "utf8").split("\\n").map((line) => line.trim()).filter(Boolean));
}
if (args.at(-1).includes("compatible-revision")) process.exit(0);
const remaining = [
  ...(ignored("--err-ignore").has(ERROR_FINDING) ? [] : [ERROR_FINDING]),
  ...(ignored("--warn-ignore").has(WARNING_FINDING) ? [] : [WARNING_FINDING]),
];
if (remaining.length > 0) {
  console.log(remaining.join("\\n"));
  process.exit(1);
}
process.exit(0);
`,
    "utf8",
  );
  await chmod(path, 0o755);
  return path;
}

function runCompatibility({ base, revision, waivers, binary, mode }) {
  return spawnSync(process.execPath, [RUNNER, base, revision, waivers], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      OASDIFF_BIN: binary,
      OPENAPI_WAIVER_TODAY: TODAY,
      ...(mode ? { FAKE_OASDIFF_MODE: mode } : {}),
    },
  });
}

async function writeWaiver(
  directory,
  {
    expiresOn = "2026-08-31",
    severity = "ERR",
    fingerprint = ERROR_FINDING,
    baseHash = await sha256File(BREAKING_BASE),
    revisionHash = await sha256File(BREAKING_REVISION),
    id = "API-WAIVER-0001",
  } = {},
) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${id}.yaml`),
    `id: ${id}
owner: hiephanguyen01
reason: Approve this exact compatibility finding for deterministic runner tests.
expiresOn: ${expiresOn}
baseContractSha256: "${baseHash}"
revisionContractSha256: "${revisionHash}"
findings:
  - severity: ${severity}
    fingerprint: ${JSON.stringify(fingerprint)}
`,
    "utf8",
  );
}

test("returns 0 for compatible contracts", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await mkdir(waivers);
    const result = runCompatibility({
      base: COMPATIBLE_BASE,
      revision: COMPATIBLE_REVISION,
      waivers,
      binary: await createFakeOasdiff(directory),
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

test("returns 1 for an unwaived breaking change", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await mkdir(waivers);
    const result = runCompatibility({
      base: BREAKING_BASE,
      revision: BREAKING_REVISION,
      waivers,
      binary: await createFakeOasdiff(directory),
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /unwaived OpenAPI compatibility findings remain/);
  });
});

test("returns 0 when every finding is exactly waived", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await writeWaiver(waivers);
    await writeWaiver(waivers, {
      id: "API-WAIVER-0002",
      severity: "WARN",
      fingerprint: WARNING_FINDING,
    });
    const result = runCompatibility({
      base: BREAKING_BASE,
      revision: BREAKING_REVISION,
      waivers,
      binary: await createFakeOasdiff(directory),
    });
    assert.equal(result.status, 0, result.stderr);
  });
});

test("returns 2 for an expired waiver", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await writeWaiver(waivers, { expiresOn: TODAY });
    const result = runCompatibility({
      base: BREAKING_BASE,
      revision: BREAKING_REVISION,
      waivers,
      binary: await createFakeOasdiff(directory),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /expired on 2026-08-04/);
  });
});

test("returns 1 when waiver hashes do not match", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await writeWaiver(waivers, { baseHash: "1".repeat(64), revisionHash: "2".repeat(64) });
    const result = runCompatibility({
      base: BREAKING_BASE,
      revision: BREAKING_REVISION,
      waivers,
      binary: await createFakeOasdiff(directory),
    });
    assert.equal(result.status, 1, result.stderr);
  });
});

test("returns 2 when a selected waiver claims an absent finding", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await writeWaiver(waivers, { fingerprint: `${ERROR_FINDING}!` });
    const result = runCompatibility({
      base: BREAKING_BASE,
      revision: BREAKING_REVISION,
      waivers,
      binary: await createFakeOasdiff(directory),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /is absent from the raw oasdiff report/);
  });
});

test("returns 2 when the oasdiff binary is missing", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await mkdir(waivers);
    const result = runCompatibility({
      base: COMPATIBLE_BASE,
      revision: COMPATIBLE_REVISION,
      waivers,
      binary: join(directory, "missing-oasdiff"),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unable to execute oasdiff/);
  });
});

test("returns 2 for unparseable single-line output", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await mkdir(waivers);
    const result = runCompatibility({
      base: BREAKING_BASE,
      revision: BREAKING_REVISION,
      waivers,
      binary: await createFakeOasdiff(directory),
      mode: "unparseable",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unparseable oasdiff finding/);
  });
});

test("returns 2 for an unexpected oasdiff exit code", async () => {
  await withTemporaryDirectory(async (directory) => {
    const waivers = join(directory, "waivers");
    await mkdir(waivers);
    const result = runCompatibility({
      base: BREAKING_BASE,
      revision: BREAKING_REVISION,
      waivers,
      binary: await createFakeOasdiff(directory),
      mode: "unexpected-exit",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unexpected oasdiff exit code 9/);
  });
});
