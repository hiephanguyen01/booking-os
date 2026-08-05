import { PasswordCommandForm } from "./password-command-form";

export function PasswordResetForm() {
  return (
    <PasswordCommandForm
      action="/api/auth/password/reset"
      idleLabel="Reset password"
      pendingLabel="Submitting…"
      successMessage="Your password has been reset."
      failureMessage="We couldn't reset your password. Request a new reset link and try again."
    />
  );
}
