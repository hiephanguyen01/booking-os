import assert from "node:assert/strict";
import test from "node:test";

import { createHealthResponseFixture } from "@booking-os/testing";

import { resolveApiServiceStatus } from "./service-status.js";

test("maps an ok API response to healthy status", async () => {
  const status = await resolveApiServiceStatus(async () =>
    createHealthResponseFixture({ status: "ok", version: "0.1.0" }),
  );

  assert.deepEqual(status, { state: "healthy", version: "0.1.0" });
});

test("maps API failure to safe degraded status", async () => {
  const status = await resolveApiServiceStatus(async () => {
    throw new Error("network failed");
  });

  assert.deepEqual(status, {
    state: "degraded",
    reason: "API unavailable",
  });
});
