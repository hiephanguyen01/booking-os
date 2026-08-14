import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("Task 7 exposes the dedicated identity-access verification command", () => {
  assert.equal(
    packageJson.scripts["verify:identity-access"],
    "node scripts/verify-identity-access.mjs",
  );
});

test("Task 7 CI runs identity-access acceptance before build", () => {
  assert.match(ciWorkflow, /identity-access:\n {4}name: Identity access acceptance/u);
  assert.match(ciWorkflow, /run: pnpm verify:identity-access/u);
  assert.match(ciWorkflow, /build:\n {4}name: Build\n {4}needs: identity-access/u);
});
