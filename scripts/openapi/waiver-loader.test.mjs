import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadWaivers, sha256File } from "./waiver-loader.mjs";

const TODAY = "2026-08-04";
const VALID_FIXTURE = "scripts/openapi/fixtures/waivers/valid/API-WAIVER-0001.yaml";

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "booking-os-waivers-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("loads one assigned, active, schema-valid waiver", async () => {
  const waivers = await loadWaivers("scripts/openapi/fixtures/waivers/valid", {
    today: TODAY,
  });

  assert.equal(waivers.length, 1);
  assert.equal(waivers[0].id, "API-WAIVER-0001");
  assert.equal(waivers[0].owner, "hiephanguyen01");
  assert.equal(Object.isFrozen(waivers[0]), true);
  assert.equal(Object.isFrozen(waivers[0].findings), true);
});

test("calculates a stable lowercase SHA-256 digest", async () => {
  await withTemporaryDirectory(async (directory) => {
    const path = join(directory, "contract.json");
    await writeFile(path, "booking-os\n", "utf8");

    assert.equal(
      await sha256File(path),
      "7840c24c13397db3ca2b959d26c9d6ad94c58eef6d65d90bf4ed32857d06fad4",
    );
  });
});

test("rejects a waiver that expires on the current date", async () => {
  await assert.rejects(
    loadWaivers("scripts/openapi/fixtures/waivers/expired", { today: TODAY }),
    /API-WAIVER-0001 expired on 2026-08-04/,
  );
});

test("rejects a schema-invalid waiver", async () => {
  await assert.rejects(
    loadWaivers("scripts/openapi/fixtures/waivers/invalid", { today: TODAY }),
    /schema validation failed/,
  );
});

test("rejects impossible UTC calendar dates", async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await readFile(VALID_FIXTURE, "utf8");
    await writeFile(
      join(directory, "API-WAIVER-0001.yaml"),
      fixture.replace("expiresOn: 2026-08-31", "expiresOn: 2026-02-31"),
      "utf8",
    );

    await assert.rejects(loadWaivers(directory, { today: TODAY }), /invalid UTC date/);
  });
});

test("rejects duplicate waiver IDs deterministically", async () => {
  await withTemporaryDirectory(async (directory) => {
    const fixture = await readFile(VALID_FIXTURE, "utf8");
    await writeFile(join(directory, "a.yaml"), fixture, "utf8");
    await writeFile(join(directory, "b.yaml"), fixture, "utf8");

    await assert.rejects(
      loadWaivers(directory, { today: TODAY }),
      /duplicate waiver id: API-WAIVER-0001/,
    );
  });
});
