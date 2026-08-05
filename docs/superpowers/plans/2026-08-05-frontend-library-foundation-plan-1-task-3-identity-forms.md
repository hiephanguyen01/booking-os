# Plan 1 — Task 3: Component Harness and Identity Form Migration

**Consumes:** UI subpath exports and `@booking-os/contracts/identity` from Task 2.

**Produces:** JSDOM component tests and React Hook Form implementations for all existing identity forms.

## Task 3.1: Configure Web Console Component Tests

**Files:**
- Create: `apps/web-console/vitest.config.ts`
- Create: `apps/web-console/src/test/setup.ts`
- Create: `apps/web-console/src/test/component-harness.test.tsx`
- Modify: `apps/web-console/package.json`

- [ ] **Step 1: Write the failing harness**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

it("renders React components in a browser-like DOM", () => {
  render(<label>Email address<input aria-label="Email address" /></label>);
  expect(screen.getByLabelText("Email address")).toBeTruthy();
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @booking-os/web-console exec vitest run
```

Expected: FAIL with `document is not defined` because Vitest defaults to Node.

- [ ] **Step 3: Configure JSDOM and cleanup**

```ts
// apps/web-console/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3002/" } },
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
```

```ts
// apps/web-console/src/test/setup.ts
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

Change the package test script to:

```json
"test": "node --test --import tsx \"src/**/*.test.ts\" \"app/**/*.test.ts\" && vitest run"
```

- [ ] **Step 4: Run GREEN**

```bash
pnpm --filter @booking-os/web-console test
```

Expected: existing node tests and the JSDOM harness pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web-console/vitest.config.ts apps/web-console/src/test apps/web-console/package.json
git commit -m "test(web-console): add component test harness"
```

## Task 3.2: Migrate All Identity Forms

**Files:**
- Create: `apps/web-console/src/lib/identity/post-identity-command.ts`
- Create: `apps/web-console/src/components/identity/submission-message.tsx`
- Create: `apps/web-console/src/components/identity/password-command-form.tsx`
- Create: `apps/web-console/src/components/identity/activation-form.tsx`
- Create: `apps/web-console/src/components/identity/password-reset-form.tsx`
- Create: `apps/web-console/src/components/identity/forgot-password-form.tsx`
- Create: `apps/web-console/src/components/identity/index.ts`
- Create: `apps/web-console/src/components/identity/identity-forms.test.tsx`
- Replace: `apps/web-console/src/components/identity-forms.tsx`

**Interfaces:**
- `postIdentityCommand(path: string, body: unknown, signal?: AbortSignal): Promise<Response>`
- Activation/reset body remains `{ scopeType: "platform", token, newPassword }`.
- Forgot-password body remains `{ scopeType: "platform", email }`.
- Tokens remain component-memory-only and are removed by the existing fragment helper.

- [ ] **Step 1: Write failing behavior tests**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ActivationForm } from "./activation-form.js";
import { ForgotPasswordForm } from "./forgot-password-form.js";
import { PasswordResetForm } from "./password-reset-form.js";

beforeEach(() => {
  window.history.replaceState(null, "", "/activate#token=browser-selector.browser-verifier");
});

it("blocks mismatched activation passwords without a request", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<ActivationForm />);
  const submit = screen.getByRole("button", { name: "Activate account" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
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
  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
  await user.type(screen.getByLabelText("Confirm new password"), "Long-enough-password-123!");
  await user.click(submit);
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/activation/complete",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        scopeType: "platform",
        token: "browser-selector.browser-verifier",
        newPassword: "Long-enough-password-123!",
      }),
    }),
  );
  expect(window.location.hash).toBe("");
});

it("uses reset endpoint and preserves reset failure copy", async () => {
  window.history.replaceState(null, "", "/password/reset#token=browser-selector.browser-verifier");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 502 }));
  const user = userEvent.setup();
  render(<PasswordResetForm />);
  const submit = screen.getByRole("button", { name: "Reset password" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
  await user.type(screen.getByLabelText("Confirm new password"), "Long-enough-password-123!");
  await user.click(submit);
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/password/reset",
    expect.objectContaining({ method: "POST" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("We couldn't reset your password");
});

it("blocks malformed forgot-password email without a request", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("Email address"), "not-an-email");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Enter a valid email address.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("normalizes email and preserves neutral success copy", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("Email address"), " User@Example.Test ");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/password/forgot",
    expect.objectContaining({
      body: JSON.stringify({ scopeType: "platform", email: "user@example.test" }),
    }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "If an account matches that email, a reset link will be sent.",
  );
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @booking-os/contracts build
pnpm --filter @booking-os/ui build
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
```

Expected: FAIL because the new identity modules do not exist.

- [ ] **Step 3: Implement the request and status helpers**

```ts
// apps/web-console/src/lib/identity/post-identity-command.ts
export function postIdentityCommand(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}
```

```tsx
// submission-message.tsx
import { Alert } from "@booking-os/ui/alert";

export type SubmissionState =
  | { state: "idle" | "submitting" }
  | { state: "success"; message: string }
  | { state: "error"; message: string };

export function SubmissionMessage({ value }: Readonly<{ value: SubmissionState }>) {
  if (value.state === "success") {
    return <Alert role="status" variant="success">{value.message}</Alert>;
  }
  if (value.state === "error") {
    return <Alert variant="destructive">{value.message}</Alert>;
  }
  return null;
}
```

- [ ] **Step 4: Implement the shared password form**

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  passwordCommandFormSchema,
  type PasswordCommandFormValues,
} from "@booking-os/contracts/identity";
import { Alert } from "@booking-os/ui/alert";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { consumeIdentityTokenFragment } from "../../lib/identity/fragment-token";
import { postIdentityCommand } from "../../lib/identity/post-identity-command";
import { SubmissionMessage, type SubmissionState } from "./submission-message";

const VALIDATION_COPY = {
  PASSWORD_TOO_SHORT: "Use at least 12 characters.",
  PASSWORD_CONFIRMATION_MISMATCH: "The passwords do not match.",
  REQUIRED: "This field is required.",
} as const;

function validationMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return VALIDATION_COPY[value as keyof typeof VALIDATION_COPY] ?? "Check this value.";
}

type Props = {
  action: "/api/auth/activation/complete" | "/api/auth/password/reset";
  idPrefix: "activation" | "password-reset";
  idleLabel: string;
  pendingLabel: string;
  successMessage: string;
  failureMessage: string;
};

export function PasswordCommandForm({
  action,
  idPrefix,
  idleLabel,
  pendingLabel,
  successMessage,
  failureMessage,
}: Props) {
  const consumed = useRef(false);
  const [tokenState, setTokenState] = useState<{ ready: boolean; token: string | null }>({
    ready: false,
    token: null,
  });
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });
  const form = useForm<PasswordCommandFormValues>({
    resolver: zodResolver(passwordCommandFormSchema),
    defaultValues: { newPassword: "", confirmation: "" },
  });

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    setTokenState({
      ready: true,
      token: consumeIdentityTokenFragment(window.location, window.history),
    });
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!tokenState.token) {
      setSubmission({
        state: "error",
        message: "This link is invalid or incomplete. Request a new link and try again.",
      });
      return;
    }
    setSubmission({ state: "submitting" });
    try {
      const response = await postIdentityCommand(action, {
        scopeType: "platform",
        token: tokenState.token,
        newPassword: values.newPassword,
      });
      setSubmission(
        response.ok
          ? { state: "success", message: successMessage }
          : { state: "error", message: failureMessage },
      );
    } catch {
      setSubmission({ state: "error", message: failureMessage });
    }
  });

  const missingToken = tokenState.ready && tokenState.token === null;
  return <form className="grid gap-4" onSubmit={onSubmit} noValidate>
    <FormField
      id={`${idPrefix}-new-password`}
      label="New password"
      description="Use at least 12 characters."
      error={validationMessage(form.formState.errors.newPassword?.message)}
    >
      {(a11y) => <Input id={`${idPrefix}-new-password`} type="password" autoComplete="new-password" {...form.register("newPassword")} {...a11y} />}
    </FormField>
    <FormField
      id={`${idPrefix}-confirmation`}
      label="Confirm new password"
      error={validationMessage(form.formState.errors.confirmation?.message)}
    >
      {(a11y) => <Input id={`${idPrefix}-confirmation`} type="password" autoComplete="new-password" {...form.register("confirmation")} {...a11y} />}
    </FormField>
    <SubmitButton
      className="w-full"
      idleLabel={idleLabel}
      pendingLabel={pendingLabel}
      pending={form.formState.isSubmitting || submission.state === "submitting"}
      disabled={!tokenState.ready || missingToken}
    />
    {missingToken ? <Alert variant="destructive">This link is invalid or incomplete. Request a new link and try again.</Alert> : null}
    <SubmissionMessage value={submission} />
  </form>;
}
```

- [ ] **Step 5: Implement activation and reset wrappers**

```tsx
// activation-form.tsx
import { PasswordCommandForm } from "./password-command-form";
export function ActivationForm() {
  return <PasswordCommandForm
    action="/api/auth/activation/complete"
    idPrefix="activation"
    idleLabel="Activate account"
    pendingLabel="Submitting…"
    successMessage="Your account has been activated."
    failureMessage="We couldn't activate your account. Request a new activation link and try again."
  />;
}
```

```tsx
// password-reset-form.tsx
import { PasswordCommandForm } from "./password-command-form";
export function PasswordResetForm() {
  return <PasswordCommandForm
    action="/api/auth/password/reset"
    idPrefix="password-reset"
    idleLabel="Reset password"
    pendingLabel="Submitting…"
    successMessage="Your password has been reset."
    failureMessage="We couldn't reset your password. Request a new reset link and try again."
  />;
}
```

- [ ] **Step 6: Implement forgot-password**

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  forgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from "@booking-os/contracts/identity";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { postIdentityCommand } from "../../lib/identity/post-identity-command";
import { SubmissionMessage, type SubmissionState } from "./submission-message";

const EMAIL_COPY = {
  REQUIRED: "Email address is required.",
  INVALID_EMAIL: "Enter a valid email address.",
} as const;

export function ForgotPasswordForm() {
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmission({ state: "submitting" });
    try {
      const response = await postIdentityCommand("/api/auth/password/forgot", {
        scopeType: "platform",
        email: values.email,
      });
      setSubmission(
        response.ok
          ? { state: "success", message: "If an account matches that email, a reset link will be sent." }
          : { state: "error", message: "We couldn't process your request. Try again shortly." },
      );
    } catch {
      setSubmission({ state: "error", message: "We couldn't process your request. Try again shortly." });
    }
  });

  const code = form.formState.errors.email?.message;
  const error = typeof code === "string" ? EMAIL_COPY[code as keyof typeof EMAIL_COPY] : undefined;
  return <form className="grid gap-4" onSubmit={onSubmit} noValidate>
    <FormField id="forgot-password-email" label="Email address" error={error}>
      {(a11y) => <Input id="forgot-password-email" type="email" autoComplete="email" {...form.register("email")} {...a11y} />}
    </FormField>
    <SubmitButton
      className="w-full"
      idleLabel="Send reset link"
      pendingLabel="Sending…"
      pending={form.formState.isSubmitting || submission.state === "submitting"}
    />
    <SubmissionMessage value={submission} />
  </form>;
}
```

- [ ] **Step 7: Add exports and compatibility module**

```ts
// apps/web-console/src/components/identity/index.ts
export { ActivationForm } from "./activation-form";
export { ForgotPasswordForm } from "./forgot-password-form";
export { PasswordResetForm } from "./password-reset-form";
```

Replace `apps/web-console/src/components/identity-forms.tsx`:

```ts
export { ActivationForm, ForgotPasswordForm, PasswordResetForm } from "./identity";
```

- [ ] **Step 8: Run GREEN**

```bash
pnpm --filter @booking-os/contracts build
pnpm --filter @booking-os/ui build
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
pnpm --filter @booking-os/web-console test
pnpm --filter @booking-os/web-console typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 9: Commit**

```bash
git add apps/web-console/src/lib/identity/post-identity-command.ts apps/web-console/src/components/identity apps/web-console/src/components/identity-forms.tsx
git commit -m "feat(web-console): migrate identity forms to React Hook Form"
```
