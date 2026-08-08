import type { BrowserContext } from "@playwright/test";

import {
  createPlaywrightSession,
  type PlaywrightSessionInput,
} from "../../api/test/helpers/playwright-session-fixture.ts";

const SESSION_COOKIE = "__Host-booking_session";

type InstallAuthenticatedSessionInput = PlaywrightSessionInput & {
  readonly origin: string;
};

export async function installAuthenticatedSession(
  context: BrowserContext,
  input: InstallAuthenticatedSessionInput,
): Promise<void> {
  const token = await createPlaywrightSession(input);

  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      url: input.origin,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}
