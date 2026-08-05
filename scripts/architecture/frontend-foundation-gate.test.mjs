import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the foundation gate enforces frontend library boundaries", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const foundation = packageJson.scripts?.["verify:foundation"];

  assert.equal(typeof foundation, "string");
  assert.match(
    foundation,
    /pnpm verify:architecture && pnpm verify:frontend-libraries && pnpm lint/,
  );
});
