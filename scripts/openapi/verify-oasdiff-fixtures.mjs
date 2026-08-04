import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const RUNNER = resolve("scripts/openapi/check-breaking.mjs");
const COMPATIBLE_BASE = "scripts/openapi/fixtures/compatible-base.json";
const COMPATIBLE_REVISION = "scripts/openapi/fixtures/compatible-revision.json";
const BREAKING_BASE = "scripts/openapi/fixtures/breaking-base.json";
const BREAKING_REVISION = "scripts/openapi/fixtures/breaking-revision.json";
const EMPTY_WAIVERS = "docs/api/compatibility-waivers";
const FIXTURE_ROOT = "scripts/openapi/fixtures/waivers";

const cases = [
  {
    name: "compatible contracts",
    base: COMPATIBLE_BASE,
    revision: COMPATIBLE_REVISION,
    waivers: EMPTY_WAIVERS,
    expected: 0,
  },
  {
    name: "unwaived breaking change",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: EMPTY_WAIVERS,
    expected: 1,
  },
  {
    name: "exact active waiver",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: `${FIXTURE_ROOT}/valid`,
    expected: 0,
  },
  {
    name: "expired waiver",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: `${FIXTURE_ROOT}/expired`,
    expected: 2,
  },
  {
    name: "wrong contract hashes",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: `${FIXTURE_ROOT}/wrong-hash`,
    expected: 1,
  },
  {
    name: "wrong severity",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: `${FIXTURE_ROOT}/wrong-severity`,
    expected: 2,
  },
  {
    name: "out-of-scope fingerprint",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: `${FIXTURE_ROOT}/out-of-scope`,
    expected: 2,
  },
  {
    name: "schema-invalid waiver",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: `${FIXTURE_ROOT}/invalid`,
    expected: 2,
  },
  {
    name: "duplicate finding in one waiver",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: `${FIXTURE_ROOT}/duplicate-finding`,
    expected: 2,
  },
  {
    name: "duplicate claim across waivers",
    base: BREAKING_BASE,
    revision: BREAKING_REVISION,
    waivers: `${FIXTURE_ROOT}/duplicate-claim`,
    expected: 2,
  },
];

let failures = 0;
for (const fixture of cases) {
  const result = spawnSync(
    process.execPath,
    [RUNNER, fixture.base, fixture.revision, fixture.waivers],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENAPI_WAIVER_TODAY: "2026-08-04",
      },
    },
  );

  if (result.error) {
    console.error(`${fixture.name}: unable to start runner: ${result.error.message}`);
    failures += 1;
    continue;
  }

  if (result.status !== fixture.expected) {
    console.error(
      `${fixture.name}: expected exit ${fixture.expected}, received ${String(result.status)}\n${result.stdout}${result.stderr}`,
    );
    failures += 1;
    continue;
  }

  console.log(`${fixture.name}: exit ${fixture.expected}`);
}

if (failures > 0) {
  console.error(`${failures} compatibility fixture verification case(s) failed`);
  process.exitCode = 1;
}
