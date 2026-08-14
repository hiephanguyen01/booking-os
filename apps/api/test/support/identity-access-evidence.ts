import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

export const identityAccessTest = process.env.IDENTITY_ACCESS_MATRIX === "1" ? test : test.skip;

export function runIdentityAccessEvidence(
  acceptanceCriterion: string,
  files: readonly string[],
): void {
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "--import", "tsx", ...files],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, IDENTITY_ACCESS_MATRIX: "0" },
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  if (result.error) throw result.error;

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  assert.equal(result.status, 0, `${acceptanceCriterion} evidence failed\n${output}`);
}
