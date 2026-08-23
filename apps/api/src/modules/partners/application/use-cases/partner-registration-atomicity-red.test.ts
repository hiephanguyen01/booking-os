import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Partner registration PostgreSQL atomicity suite is green", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      "--import",
      "tsx",
      "test/partner-registration-concurrency.e2e.test.ts",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
