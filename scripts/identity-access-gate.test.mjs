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

test("Task 7 preserves the identity-access gate inside Foundation verification", () => {
  assert.match(packageJson.scripts["verify:foundation"], /pnpm verify:identity-access/u);
});

test("Task 7 includes a dedicated browser identity-access acceptance spec", async () => {
  const browserSpec = await readFile(new URL("../e2e/identity-access.spec.ts", import.meta.url), "utf8");
  assert.match(browserSpec, /identity-access browser acceptance/u);
  assert.match(browserSpec, /__Host-booking_session/u);
  assert.match(browserSpec, /token/u);
});
