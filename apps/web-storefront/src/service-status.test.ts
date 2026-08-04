import assert from "node:assert/strict";
import test from "node:test";

import { createHealthResponseFixture } from "@booking-os/testing";

import { resolveApiServiceStatus } from "./service-status.js";

test("maps an ok API health response to a healthy service status", async () => {
  const status = await resolveApiServiceStatus(async () =>
    createHealthResponseFixture({ status: "ok", version: "0.1.0" }),
  );

  assert.deepEqual(status, { state: "healthy", version: "0.1.0" });
});

test("maps API failures to a safe degraded service status", async () => {
  const status = await resolveApiServiceStatus(async () => {
    throw new Error("connect ECONNREFUSED http://localhost:3001/api/health");
  });

  assert.deepEqual(status, {
    state: "degraded",
    reason: "API unavailable",
  });
});
