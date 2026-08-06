import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { withDirectoryLock } from "./shared-client-lock.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("serializes concurrent work using one shared directory lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "booking-os-prisma-lock-"));
  const lockPath = path.join(directory, "generate.lock");
  let active = 0;
  let maximumActive = 0;
  const completed = [];

  try {
    await Promise.all(
      ["first", "second", "third"].map((name) =>
        withDirectoryLock(
          lockPath,
          async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await delay(20);
            completed.push(name);
            active -= 1;
          },
          { retryDelayMs: 5, timeoutMs: 2_000 },
        ),
      ),
    );

    assert.equal(maximumActive, 1);
    assert.deepEqual(new Set(completed), new Set(["first", "second", "third"]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("releases the shared lock when work fails", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "booking-os-prisma-lock-"));
  const lockPath = path.join(directory, "generate.lock");

  try {
    await assert.rejects(
      withDirectoryLock(lockPath, async () => {
        throw new Error("expected failure");
      }),
      /expected failure/,
    );

    const value = await withDirectoryLock(lockPath, async () => "recovered");
    assert.equal(value, "recovered");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
