import { LoginForm } from "../../src/components/session/login-form.js";

export default function LoginPage() {
  return (
    <main>
      <section aria-labelledby="login-title">
        <p>Booking OS</p>
        <h1 id="login-title">Sign in</h1>
        <p>Use your workspace credentials to continue.</p>
        <LoginForm />
      </section>
    </main>
  );
}
