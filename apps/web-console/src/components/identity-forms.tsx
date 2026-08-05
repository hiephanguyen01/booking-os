"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { consumeIdentityTokenFragment } from "../lib/identity/fragment-token";

const MINIMUM_PASSWORD_LENGTH = 12;
const PLATFORM_SCOPE = "platform" as const;

interface FragmentTokenState {
  readonly ready: boolean;
  readonly token: string | null;
}

type SubmissionState =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "submitting" }>
  | Readonly<{ state: "success"; message: string }>
  | Readonly<{ state: "error"; message: string }>;

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

function useIdentityFragmentToken(): FragmentTokenState {
  const consumed = useRef(false);
  const [tokenState, setTokenState] = useState<FragmentTokenState>({
    ready: false,
    token: null,
  });

  useEffect(() => {
    if (consumed.current) {
      return;
    }

    consumed.current = true;
    const token = consumeIdentityTokenFragment(window.location, window.history);
    setTokenState({ ready: true, token });
  }, []);

  return tokenState;
}

interface PasswordCommandFormProps {
  readonly action: string;
  readonly buttonLabel: string;
  readonly failureMessage: string;
  readonly successMessage: string;
}

function PasswordCommandForm({
  action,
  buttonLabel,
  failureMessage,
  successMessage,
}: PasswordCommandFormProps) {
  const tokenState = useIdentityFragmentToken();
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });

  const missingToken = tokenState.ready && tokenState.token === null;
  const submitting = submission.state === "submitting";

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!tokenState.token) {
      setSubmission({
        state: "error",
        message: "This link is invalid or incomplete. Request a new link and try again.",
      });
      return;
    }

    if (newPassword !== confirmation) {
      setSubmission({ state: "error", message: "The passwords do not match." });
      return;
    }

    setSubmission({ state: "submitting" });

    try {
      const response = await postJson(action, {
        scopeType: PLATFORM_SCOPE,
        token: tokenState.token,
        newPassword,
      });

      setSubmission(
        response.ok
          ? { state: "success", message: successMessage }
          : { state: "error", message: failureMessage },
      );
    } catch {
      setSubmission({ state: "error", message: failureMessage });
    }
  }

  return (
    <form className="identity-form" onSubmit={submit}>
      <div className="identity-field">
        <label htmlFor={`${action}-new-password`}>New password</label>
        <input
          id={`${action}-new-password`}
          type="password"
          autoComplete="new-password"
          minLength={MINIMUM_PASSWORD_LENGTH}
          required
          value={newPassword}
          onChange={(event) => setNewPassword(event.currentTarget.value)}
        />
      </div>

      <div className="identity-field">
        <label htmlFor={`${action}-confirm-password`}>Confirm new password</label>
        <input
          id={`${action}-confirm-password`}
          type="password"
          autoComplete="new-password"
          minLength={MINIMUM_PASSWORD_LENGTH}
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.currentTarget.value)}
        />
      </div>

      <button type="submit" disabled={!tokenState.ready || missingToken || submitting}>
        {submitting ? "Submitting…" : buttonLabel}
      </button>

      {missingToken ? (
        <p role="alert">This link is invalid or incomplete. Request a new link and try again.</p>
      ) : null}
      {submission.state === "error" ? <p role="alert">{submission.message}</p> : null}
      {submission.state === "success" ? <p role="status">{submission.message}</p> : null}
    </form>
  );
}

export function ActivationForm() {
  return (
    <PasswordCommandForm
      action="/api/auth/activation/complete"
      buttonLabel="Activate account"
      failureMessage="We couldn't activate your account. Request a new activation link and try again."
      successMessage="Your account has been activated."
    />
  );
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });
  const submitting = submission.state === "submitting";

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmission({ state: "submitting" });

    try {
      const response = await postJson("/api/auth/password/forgot", {
        scopeType: PLATFORM_SCOPE,
        email,
      });

      setSubmission(
        response.ok
          ? {
              state: "success",
              message: "If an account matches that email, a reset link will be sent.",
            }
          : {
              state: "error",
              message: "We couldn't process your request. Try again shortly.",
            },
      );
    } catch {
      setSubmission({
        state: "error",
        message: "We couldn't process your request. Try again shortly.",
      });
    }
  }

  return (
    <form className="identity-form" onSubmit={submit}>
      <div className="identity-field">
        <label htmlFor="forgot-password-email">Email address</label>
        <input
          id="forgot-password-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? "Sending…" : "Send reset link"}
      </button>

      {submission.state === "error" ? <p role="alert">{submission.message}</p> : null}
      {submission.state === "success" ? <p role="status">{submission.message}</p> : null}
    </form>
  );
}

export function PasswordResetForm() {
  return (
    <PasswordCommandForm
      action="/api/auth/password/reset"
      buttonLabel="Reset password"
      failureMessage="We couldn't reset your password. Request a new reset link and try again."
      successMessage="Your password has been reset."
    />
  );
}
