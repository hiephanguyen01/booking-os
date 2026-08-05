import { PasswordResetForm } from "../../../src/components/identity-forms";

export default function ResetPasswordPage() {
  return (
    <main className="console-shell">
      <section className="identity-shell" aria-labelledby="reset-password-title">
        <p className="product-label">Booking OS</p>
        <h1 id="reset-password-title">Reset your password</h1>
        <p>Choose a new password to secure your account.</p>
        <PasswordResetForm />
      </section>
    </main>
  );
}
