"use client";

import {
  type ForgotPasswordFormValues,
  forgotPasswordFormSchema,
} from "@booking-os/contracts/identity";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { postIdentityCommand } from "../../lib/identity/post-identity-command";
import { SubmissionMessage, type SubmissionState } from "./submission-message";

const SUCCESS_MESSAGE = "If an account matches that email, a reset link will be sent.";
const FAILURE_MESSAGE = "We couldn't process your request. Try again shortly.";

function emailValidationMessage(value: unknown): string | undefined {
  if (value === "REQUIRED") return "This field is required.";
  if (value === "INVALID_EMAIL") return "Enter a valid email address.";
  return undefined;
}

export function ForgotPasswordForm() {
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: {
      email: "",
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setSubmission({ state: "submitting" });

    try {
      const response = await postIdentityCommand("/api/auth/password/forgot", {
        email: values.email,
      });

      setSubmission(
        response.ok
          ? { state: "success", message: SUCCESS_MESSAGE }
          : { state: "error", message: FAILURE_MESSAGE },
      );
    } catch {
      setSubmission({ state: "error", message: FAILURE_MESSAGE });
    }
  });

  const emailError = emailValidationMessage(form.formState.errors.email?.message);

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <FormField
        id="forgot-password-email"
        label="Email address"
        {...(emailError ? { error: emailError } : {})}
      >
        {(accessibility) => (
          <Input
            id="forgot-password-email"
            type="email"
            autoComplete="email"
            {...form.register("email")}
            {...accessibility}
          />
        )}
      </FormField>

      <SubmitButton
        className="w-full"
        idleLabel="Send reset link"
        pendingLabel="Sending…"
        pending={form.formState.isSubmitting || submission.state === "submitting"}
      />
      <SubmissionMessage value={submission} />
    </form>
  );
}
