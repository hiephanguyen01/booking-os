import type { BrowserContext } from "@playwright/test";

const SESSION_COOKIE = "__Host-booking_session";

export async function installHostOnlySessionCookie(
  context: BrowserContext,
  origin: string,
  token: string,
): Promise<void> {
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  try {
    const { success } = await client.send("Network.setCookie", {
      name: SESSION_COOKIE,
      value: token,
      url: origin,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });

    if (!success) {
      throw new Error("Chromium rejected the Playwright session cookie.");
    }
  } finally {
    await client.detach();
    await page.close();
  }
}
