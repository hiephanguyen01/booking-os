"use client";

import {
  type PasswordCommandFormValues,
  passwordCommandFormSchema,
} from "@booking-os/contracts/identity";
import { Alert } from "@booking-os/ui/alert";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import {
  type ActivationFragment,
  consumeActivationFragment,
} from "../../lib/identity/fragment-token";
import { postIdentityCommand } from "../../lib/identity/post-identity-command";
import { SubmissionMessage, type SubmissionState } from "./submission-message";

const INVALID_LINK_MESSAGE =
  "This link is invalid or incomplete. Request a new link and try again.";
const ACTIVATION_FAILURE =
  "We couldn't activate your account. Request a new activation link and try again.";
const LOGIN_FAILURE = "Your account is active, but we couldn't sign you in automatically.";

const validationMessages = {
  PASSWORD_TOO_SHORT: "Use at least 12 characters.",
  PASSWORD_CONFIRMATION_MISMATCH: "The passwords do not match.",
  REQUIRED: "This field is required.",
} as const;

function validationMessage(value: unknown): string | undefined {
  return typeof value === "string"
    ? validationMessages[value as keyof typeof validationMessages]
    : undefined;
}

function readContinuationEmail(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const email = (value as Record<string, unknown>).continuationEmail;
  return typeof email === "string" && email.length > 0 ? email : null;
}

async function login(email: string, password: string): Promise<boolean> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  return response.ok;
}

export function ActivationForm() {
  const consumed = useRef(false);
  const [fragment, setFragment] = useState<ActivationFragment | null | undefined>(undefined);
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });
  const [continuationEmail, setContinuationEmail] = useState<string | null>(null);
  const form = useForm<PasswordCommandFormValues>({
    resolver: zodResolver(passwordCommandFormSchema),
    defaultValues: { newPassword: "", confirmation: "" },
  });

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    setFragment(consumeActivationFragment(window.location, window.history));
  }, []);

  async function continueOnboarding(email: string, invitationToken: string, password: string) {
    try {
      if (await login(email, password)) {
        window.location.assign(`/invite/accept#token=${encodeURIComponent(invitationToken)}`);
        return;
      }
    } catch {
      // Recovery state below intentionally preserves only in-memory continuation data.
    }
    setContinuationEmail(email);
    setSubmission({ state: "error", message: LOGIN_FAILURE });
  }

  const submit = form.handleSubmit(async (values) => {
    if (!fragment) {
      setSubmission({ state: "error", message: INVALID_LINK_MESSAGE });
      return;
    }

    setSubmission({ state: "submitting" });
    const activationToken =
      fragment.kind === "activation" ? fragment.token : fragment.activationToken;

    try {
      const response = await postIdentityCommand("/api/auth/activation/complete", {
        token: activationToken,
        newPassword: values.newPassword,
      });
      if (!response.ok) {
        setSubmission({ state: "error", message: ACTIVATION_FAILURE });
        return;
      }

      if (fragment.kind === "activation") {
        setSubmission({ state: "success", message: "Your account has been activated." });
        return;
      }

      const email = readContinuationEmail(await response.json().catch(() => null));
      if (!email) {
        setSubmission({ state: "error", message: LOGIN_FAILURE });
        return;
      }
      await continueOnboarding(email, fragment.invitationToken, values.newPassword);
    } catch {
      setSubmission({ state: "error", message: ACTIVATION_FAILURE });
    }
  });

  const missingToken = fragment === null;
  const newPasswordError = validationMessage(form.formState.errors.newPassword?.message);
  const confirmationError = validationMessage(form.formState.errors.confirmation?.message);

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <FormField
        id="activation-new-password"
        label="New password"
        description="Use at least 12 characters."
        {...(newPasswordError ? { error: newPasswordError } : {})}
      >
        {(accessibility) => (
          <Input
            id="activation-new-password"
            type="password"
            autoComplete="new-password"
            {...form.register("newPassword")}
            {...accessibility}
          />
        )}
      </FormField>
      <FormField
        id="activation-confirmation"
        label="Confirm new password"
        {...(confirmationError ? { error: confirmationError } : {})}
      >
        {(accessibility) => (
          <Input
            id="activation-confirmation"
            type="password"
            autoComplete="new-password"
            {...form.register("confirmation")}
            {...accessibility}
          />
        )}
      </FormField>

      <SubmitButton
        className="w-full"
        idleLabel="Activate account"
        pendingLabel="Submitting…"
        pending={form.formState.isSubmitting || submission.state === "submitting"}
        disabled={fragment === undefined || missingToken}
      />

      {missingToken ? <Alert variant="destructive">{INVALID_LINK_MESSAGE}</Alert> : null}
      <SubmissionMessage value={submission} />

      {continuationEmail && fragment?.kind === "owner_onboarding" ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="text-sm font-medium underline"
            onClick={() =>
              void continueOnboarding(
                continuationEmail,
                fragment.invitationToken,
                form.getValues("newPassword"),
              )
            }
          >
            Try again
          </button>
          <button
            type="button"
            className="text-sm font-medium underline"
            onClick={() =>
              window.location.assign(
                `/login#invitation=${encodeURIComponent(fragment.invitationToken)}`,
              )
            }
          >
            Continue to sign in
          </button>
        </div>
      ) : null}
    </form>
  );
}
