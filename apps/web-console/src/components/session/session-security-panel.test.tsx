import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { SessionSecurityPanel } from "./session-security-panel.js";

const currentSession = {
  id: "11111111-1111-4111-8111-111111111111",
  scope: { type: "platform" as const },
  hostname: "console.example.test",
  state: "active" as const,
  current: true,
  createdAt: "2026-08-06T10:00:00.000Z",
  lastSeenAt: "2026-08-06T14:00:00.000Z",
  idleExpiresAt: "2026-08-13T14:00:00.000Z",
  absoluteExpiresAt: "2026-09-05T10:00:00.000Z",
};

const otherSession = {
  ...currentSession,
  id: "22222222-2222-4222-8222-222222222222",
  hostname: "tablet.example.test",
  current: false,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockSessionApi(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url === "/api/auth/me" && method === "GET") {
      return Response.json({
        actor: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        session: {
          id: currentSession.id,
          state: currentSession.state,
          scope: currentSession.scope,
        },
      });
    }

    if (url === "/api/auth/sessions" && method === "GET") {
      return Response.json({ sessions: [currentSession, otherSession] });
    }

    if (
      (url === "/api/auth/session/refresh" ||
        url === "/api/auth/logout" ||
        url === "/api/auth/sessions/revoke-others") &&
      method === "POST"
    ) {
      return Response.json({ ok: true });
    }

    if (url === `/api/auth/sessions/${otherSession.id}` && method === "DELETE") {
      return Response.json({ revoked: true });
    }

    return Response.json({ error: "unexpected request" }, { status: 500 });
  });
}

it("loads the current identity and device sessions without caching", async () => {
  const fetchMock = mockSessionApi();

  render(<SessionSecurityPanel />);

  expect(await screen.findByText("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeTruthy();
  expect(screen.getByText("console.example.test")).toBeTruthy();
  expect(screen.getByText("tablet.example.test")).toBeTruthy();
  expect(screen.getByText("Current session")).toBeTruthy();

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/me",
    expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/sessions",
    expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
  );
});

it("refreshes, revokes devices, revokes other sessions, and signs out", async () => {
  const fetchMock = mockSessionApi();
  const onSignedOut = vi.fn();
  const user = userEvent.setup();

  render(<SessionSecurityPanel onSignedOut={onSignedOut} />);
  await screen.findByText("tablet.example.test");

  await user.click(screen.getByRole("button", { name: "Refresh session" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session/refresh",
      expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }),
    ),
  );

  const tablet = screen.getByRole("listitem", { name: "Session on tablet.example.test" });
  await user.click(within(tablet).getByRole("button", { name: "Revoke session" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/auth/sessions/${otherSession.id}`,
      expect.objectContaining({ method: "DELETE", credentials: "same-origin", cache: "no-store" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Revoke other sessions" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/sessions/revoke-others",
      expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(onSignedOut).toHaveBeenCalledOnce());
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/logout",
    expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }),
  );
});

it("shows a safe error without exposing upstream details", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ error: "database selector leaked" }, { status: 503 }),
  );

  render(<SessionSecurityPanel />);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("We couldn't load your sessions. Try again.");
  expect(alert.textContent).not.toContain("database selector leaked");
});
