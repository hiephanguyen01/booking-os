import type { BrowserContext } from "@playwright/test";

import {
  createPlaywrightSession,
  type PlaywrightSessionInput,
} from "../../api/test/helpers/playwright-session-fixture.ts";
import { installHostOnlySessionCookie } from "./host-only-session-cookie.ts";

type InstallAuthenticatedSessionInput = PlaywrightSessionInput & {
  readonly origin: string;
};

export async function installAuthenticatedSession(
  context: BrowserContext,
  input: InstallAuthenticatedSessionInput,
): Promise<void> {
  const token = await createPlaywrightSession(input);

  await installHostOnlySessionCookie(context, input.origin, token);
}
