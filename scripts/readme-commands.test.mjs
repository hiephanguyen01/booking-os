import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("documents canonical Genesis and OpenAPI workflows with active compatibility protection", async () => {
  const readme = await readFile(join(repositoryRoot, "README.md"), "utf8");

  for (const command of [
    'python tools/genesis_cli.py new-adr "Tên quyết định"',
    'python tools/genesis_cli.py new-feature "Tên tính năng"',
    'python tools/genesis_cli.py new-pattern "Tên pattern"',
    "pnpm genesis:validate",
    "pnpm api:generate",
    "pnpm api:check-generated",
    "go install github.com/oasdiff/oasdiff@v1.17.0",
    "pnpm api:verify-compatibility-fixtures",
  ]) {
    assert.ok(readme.includes(command), `README must document: ${command}`);
  }

  assert.match(readme, /OpenAPI compatibility/);
  assert.match(readme, /github\.event\.pull_request\.base\.sha/);
  assert.match(readme, /fail-closed/);
  assert.doesNotMatch(readme, /Compatibility gate: pending PR 2/);
});
