import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const validatorPath = join(repositoryRoot, "scripts", "delivery-reconciliation.mjs");

async function runValidator(content) {
  const directory = await mkdtemp(join(tmpdir(), "booking-os-reconciliation-"));
  const file = join(directory, "checkpoint.md");
  await writeFile(file, content, "utf8");

  try {
    return spawnSync(process.execPath, [validatorPath, "--file", file], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const validCheckpoint = `# Reconciliation\n\nPlan Status: IN_PROGRESS\nCurrent Task: Task 3\nClassification: EXPECTED_INCOMPLETE\nRequired Now: NO\nEvidence: Task 4 is explicitly pending in the active plan.\n`;

test("accepts a checkpoint with complete delivery context", async () => {
  const result = await runValidator(validCheckpoint);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

for (const field of ["Plan Status", "Current Task", "Classification", "Required Now", "Evidence"]) {
  test(`rejects a checkpoint missing ${field}`, async () => {
    const content = validCheckpoint
      .split("\n")
      .filter((line) => !line.startsWith(`${field}:`))
      .join("\n");
    const result = await runValidator(content);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, new RegExp(field.replace(" ", "\\s*"), "i"));
  });
}

test("rejects an unsupported finding classification", async () => {
  const result = await runValidator(
    validCheckpoint.replace(
      "Classification: EXPECTED_INCOMPLETE",
      "Classification: SOMETHING_ELSE",
    ),
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /classification/i);
});
