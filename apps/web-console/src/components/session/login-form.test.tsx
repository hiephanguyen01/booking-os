import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { LoginForm, resolveSafeReturnPath } from "./login-form.js";

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/login");
});

it("accepts only internal same-origin return paths", () => {
  expect(resolveSafeReturnPath(null)).toBe("/");
  expect(resolveSafeReturnPath("/security/sessions?from=login")).toBe(
    "/security/sessions?from=login",
  );
  expect(resolveSafeReturnPath("https://attacker.example.test/steal")).toBe("/");
  expect(resolveSafeReturnPath("//attacker.example.test/steal")).toBe("/");
  expect(resolveSafeReturnPath("/%2F%2Fattacker.example.test/steal")).toBe("/");
  expect(resolveSafeReturnPath("\\attacker.example.test\\steal")).toBe("/");
});

it("blocks malformed email without sending credentials", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const onAuthenticated = vi.fn();
  const user = userEvent.setup();

  render(<LoginForm onAuthenticated={onAuthenticated} />);
  await user.type(screen.getByLabelText("Email address"), "not-an-email");
  await user.type(screen.getByLabelText("Password"), "correct-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect((await screen.findByRole("alert")).textContent).toContain("Enter a valid email address.");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onAuthenticated).not.toHaveBeenCalled();
});

it("normalizes email, posts only credentials, and follows a safe return path", async () => {
  window.history.replaceState(null, "", "/login?returnTo=%2Fsecurity%2Fsessions%3Ffrom%3Dlogin");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      session: {
        id: "11111111-1111-4111-8111-111111111111",
        state: "active",
        scope: { type: "platform" },
      },
    }),
  );
  const onAuthenticated = vi.fn();
  const user = userEvent.setup();

  render(<LoginForm onAuthenticated={onAuthenticated} />);
  await user.type(screen.getByLabelText("Email address"), " User@Example.Test ");
  await user.type(screen.getByLabelText("Password"), "correct-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  await waitFor(() =>
    expect(onAuthenticated).toHaveBeenCalledWith("/security/sessions?from=login"),
  );
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/login",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        email: "user@example.test",
        password: "correct-password",
      }),
    }),
  );
});

it("shows generic failure copy and does not navigate", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ error: "specific upstream detail" }, { status: 401 }),
  );
  const onAuthenticated = vi.fn();
  const user = userEvent.setup();

  render(<LoginForm onAuthenticated={onAuthenticated} />);
  await user.type(screen.getByLabelText("Email address"), "pilot@example.test");
  await user.type(screen.getByLabelText("Password"), "wrong-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("We couldn't sign you in. Check your details and try again.");
  expect(alert.textContent).not.toContain("specific upstream detail");
  expect(onAuthenticated).not.toHaveBeenCalled();
});
