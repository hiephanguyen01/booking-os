import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "@playwright/test";

import { installHostOnlySessionCookie } from "./host-only-session-cookie.ts";

const ORIGIN = "http://tenant-a.booking.localhost:3002";
const SIBLING_ORIGIN = "http://tenant-b.booking.localhost:3002";
const TOKEN = "session-selector.session-secret";

test("installs a host-only secure HTTP-only root session cookie through Chromium", async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());

  const context = await browser.newContext();
  t.after(() => context.close());

  await installHostOnlySessionCookie(context, ORIGIN, TOKEN);

  assert.deepEqual(await context.cookies(SIBLING_ORIGIN), []);
  assert.deepEqual(await context.cookies(ORIGIN), [
    {
      name: "__Host-booking_session",
      value: TOKEN,
      domain: "tenant-a.booking.localhost",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
});
