import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_OS_SESSION_COOKIE } from "../../../src/lib/session/session-cookie";
import { createSessionStore } from "../../../src/lib/session/session-store";
import { createSessionRouteHandlers } from "./route";

test("GET returns public session metadata without the opaque token", async () => {
  const store = createSessionStore();
  const created = await store.create({ userId: "user-1", tenantId: "tenant-1" });
  const handlers = createSessionRouteHandlers(store);
  const request = new Request("https://console.example.test/api/session", {
    headers: {
      cookie: `${BOOKING_OS_SESSION_COOKIE}=${created.token}`,
      host: "console.example.test",
    },
  });

  const response = await handlers.GET(request);
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.deepEqual(body, { session: created.session });
  assert.equal(JSON.stringify(body).includes(created.token), false);
});

test("cross-origin POST is rejected before session rotation", async () => {
  const store = createSessionStore();
  const handlers = createSessionRouteHandlers(store);
  const request = new Request("https://console.example.test/api/session", {
    method: "POST",
    headers: {
      host: "console.example.test",
      origin: "https://attacker.example.test",
    },
  });

  const response = await handlers.POST(request);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "CSRF_ORIGIN_MISMATCH",
      message: "The request origin does not match the console origin.",
    },
  });
});
