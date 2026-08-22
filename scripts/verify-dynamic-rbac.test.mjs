import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const ciWorkflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");

async function readOptional(path) {
  try {
    return await readFile(new URL(path, root), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

test("Task 9 exposes the dedicated dynamic RBAC verification command", () => {
  assert.equal(packageJson.scripts["verify:dynamic-rbac"], "node scripts/verify-dynamic-rbac.mjs");
});

test("Task 9 keeps dynamic RBAC verification inside Foundation after identity access and before build", () => {
  const foundation = packageJson.scripts["verify:foundation"];
  const migrations = foundation.indexOf("pnpm verify:migrations");
  const identity = foundation.indexOf("pnpm verify:identity-access");
  const dynamicRbac = foundation.indexOf("pnpm verify:dynamic-rbac");
  const build = foundation.indexOf("pnpm build");

  assert.ok(migrations >= 0);
  assert.ok(identity > migrations);
  assert.ok(dynamicRbac > identity);
  assert.ok(build > dynamicRbac);
});

test("Task 9 protected CI runs dynamic RBAC acceptance between identity access and build", () => {
  assert.match(
    ciWorkflow,
    /dynamic-rbac:\n {4}name: Sprint 2 dynamic RBAC acceptance\n {4}needs: identity-access/u,
  );
  assert.match(ciWorkflow, /run: pnpm verify:dynamic-rbac/u);
  assert.match(ciWorkflow, /build:\n {4}name: Build\n {4}needs: dynamic-rbac/u);
});

test("Task 9 verifier executes concrete Sprint 2 evidence instead of marker-only checks", async () => {
  const verifier = await readOptional("scripts/verify-dynamic-rbac.mjs");
  assert.ok(verifier, "scripts/verify-dynamic-rbac.mjs must exist");

  for (const evidenceFile of [
    "tenant-rbac-acceptance.e2e.test.ts",
    "tenant-rbac-schema.integration.test.ts",
    "tenant-rbac-rls.integration.test.ts",
    "tenant-rbac-role-concurrency.e2e.test.ts",
    "tenant-rbac-assignment-concurrency.e2e.test.ts",
    "tenant-rbac-authoritative-context.e2e.test.ts",
    "tenant-rbac-api.e2e.test.ts",
    "tenant-rbac-api-isolation.e2e.test.ts",
  ]) {
    assert.match(verifier, new RegExp(evidenceFile.replaceAll(".", "\\."), "u"));
  }

  assert.match(verifier, /spawnSync/u);
});

test("Task 9 acceptance manifest resolves every S2-RBAC01 through S2-RBAC16 ID", async () => {
  const acceptance = await readOptional("apps/api/test/tenant-rbac-acceptance.e2e.test.ts");
  assert.ok(acceptance, "tenant-rbac-acceptance.e2e.test.ts must exist");

  for (let index = 1; index <= 16; index += 1) {
    const id = `S2-RBAC${String(index).padStart(2, "0")}`;
    assert.match(acceptance, new RegExp(id, "u"), `${id} must resolve to executable evidence`);
  }
});
