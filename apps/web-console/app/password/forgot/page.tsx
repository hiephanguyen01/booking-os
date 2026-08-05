import { ForgotPasswordForm } from "../../../src/components/identity-forms";

export default function ForgotPasswordPage() {
  return (
    <main className="console-shell">
      <section className="identity-shell" aria-labelledby="forgot-password-title">
        <p className="product-label">Booking OS</p>
        <h1 id="forgot-password-title">Forgot your password?</h1>
        <p>Request a password reset link without revealing whether an account exists.</p>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
