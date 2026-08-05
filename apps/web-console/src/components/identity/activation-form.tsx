import { PasswordCommandForm } from "./password-command-form";

export function ActivationForm() {
  return (
    <PasswordCommandForm
      action="/api/auth/activation/complete"
      idleLabel="Activate account"
      pendingLabel="Submitting…"
      successMessage="Your account has been activated."
      failureMessage="We couldn't activate your account. Request a new activation link and try again."
    />
  );
}
