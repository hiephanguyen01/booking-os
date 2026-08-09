import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ActivationForm } from "./activation-form.js";
import { ForgotPasswordForm } from "./forgot-password-form.js";
import { PasswordResetForm } from "./password-reset-form.js";

const IDENTITY_TOKEN = "browser-selector.browser-verifier";
const NEW_PASSWORD = "Long-enough-password-123!";

beforeEach(() => {
  window.history.replaceState(null, "", `/activate#token=${IDENTITY_TOKEN}`);
});

it("blocks mismatched activation passwords without a request", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();

  render(<ActivationForm />);
  const submit = screen.getByRole("button", { name: "Activate account" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
  await user.type(screen.getByLabelText("Confirm new password"), "Different-password-123!");
  await user.click(submit);

  expect((await screen.findByRole("alert")).textContent).toContain("The passwords do not match.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("submits only activation command fields and removes the fragment", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  const user = userEvent.setup();

  render(<ActivationForm />);
  const submit = screen.getByRole("button", { name: "Activate account" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
  await user.type(screen.getByLabelText("Confirm new password"), NEW_PASSWORD);
  await user.click(submit);

  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/activation/complete",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        scopeType: "platform",
        token: IDENTITY_TOKEN,
        newPassword: NEW_PASSWORD,
      }),
    }),
  );
  expect(window.location.hash).toBe("");
  expect((await screen.findByRole("status")).textContent).toContain(
    "Your account has been activated.",
  );
});

it("uses the reset endpoint and preserves reset failure copy", async () => {
  window.history.replaceState(null, "", `/password/reset#token=${IDENTITY_TOKEN}`);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 502 }));
  const user = userEvent.setup();

  render(<PasswordResetForm />);
  const submit = screen.getByRole("button", { name: "Reset password" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByLabelText("New password"), NEW_PASSWORD);
  await user.type(screen.getByLabelText("Confirm new password"), NEW_PASSWORD);
  await user.click(submit);

  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/password/reset",
    expect.objectContaining({ method: "POST" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "We couldn't reset your password",
  );
});

it("blocks malformed forgot-password email without a request", async () => {
  window.history.replaceState(null, "", "/password/forgot");
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();

  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("Email address"), "not-an-email");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  expect((await screen.findByRole("alert")).textContent).toContain("Enter a valid email address.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("normalizes email and preserves neutral success copy", async () => {
  window.history.replaceState(null, "", "/password/forgot");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
  const user = userEvent.setup();

  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("Email address"), " User@Example.Test ");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/password/forgot",
    expect.objectContaining({
      body: JSON.stringify({
        scopeType: "platform",
        email: "user@example.test",
      }),
    }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "If an account matches that email, a reset link will be sent.",
  );
});
