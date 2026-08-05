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

const PLATFORM_SCOPE = "platform" as const;
const INVALID_LINK_MESSAGE =
  "This link is invalid or incomplete. Request a new link and try again.";

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

interface PasswordCommandFormProps {
  action: "/api/auth/activation/complete" | "/api/auth/password/reset";
  idleLabel: string;
  pendingLabel: string;
  successMessage: string;
  failureMessage: string;
}

export function PasswordCommandForm({
  action,
  idleLabel,
  pendingLabel,
  successMessage,
  failureMessage,
}: PasswordCommandFormProps) {
  const consumed = useRef(false);
  const [tokenState, setTokenState] = useState<{
    ready: boolean;
    token: string | null;
  }>({ ready: false, token: null });
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });
  const form = useForm<PasswordCommandFormValues>({
    resolver: zodResolver(passwordCommandFormSchema),
    defaultValues: {
      newPassword: "",
      confirmation: "",
    },
  });

  useEffect(() => {
    if (consumed.current) return;

    consumed.current = true;
    setTokenState({
      ready: true,
      token: consumeIdentityTokenFragment(window.location, window.history),
    });
  }, []);

  const submit = form.handleSubmit(async (values) => {
    if (!tokenState.token) {
      setSubmission({ state: "error", message: INVALID_LINK_MESSAGE });
      return;
    }

    setSubmission({ state: "submitting" });

    try {
      const response = await postIdentityCommand(action, {
        scopeType: PLATFORM_SCOPE,
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
  const idPrefix = action === "/api/auth/activation/complete" ? "activation" : "password-reset";
  const newPasswordError = validationMessage(form.formState.errors.newPassword?.message);
  const confirmationError = validationMessage(form.formState.errors.confirmation?.message);

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <FormField
        id={`${idPrefix}-new-password`}
        label="New password"
        description="Use at least 12 characters."
        {...(newPasswordError ? { error: newPasswordError } : {})}
      >
        {(accessibility) => (
          <Input
            id={`${idPrefix}-new-password`}
            type="password"
            autoComplete="new-password"
            {...form.register("newPassword")}
            {...accessibility}
          />
        )}
      </FormField>

      <FormField
        id={`${idPrefix}-confirmation`}
        label="Confirm new password"
        {...(confirmationError ? { error: confirmationError } : {})}
      >
        {(accessibility) => (
          <Input
            id={`${idPrefix}-confirmation`}
            type="password"
            autoComplete="new-password"
            {...form.register("confirmation")}
            {...accessibility}
          />
        )}
      </FormField>

      <SubmitButton
        className="w-full"
        idleLabel={idleLabel}
        pendingLabel={pendingLabel}
        pending={form.formState.isSubmitting || submission.state === "submitting"}
        disabled={!tokenState.ready || missingToken}
      />

      {missingToken ? <Alert variant="destructive">{INVALID_LINK_MESSAGE}</Alert> : null}
      <SubmissionMessage value={submission} />
    </form>
  );
}
