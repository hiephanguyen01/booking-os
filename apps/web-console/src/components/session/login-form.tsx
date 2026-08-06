"use client";

import { type FormEvent, useState } from "react";

interface LoginFormProps {
  readonly onAuthenticated?: (returnPath: string) => void;
}

const GENERIC_LOGIN_ERROR = "We couldn't sign you in. Check your details and try again.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function resolveSafeReturnPath(value: string | null): string {
  if (value === null) {
    return "/";
  }

  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/";
  }

  try {
    const decoded = decodeURIComponent(candidate);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) {
      return "/";
    }

    const target = new URL(decoded, "https://console.invalid");
    return target.origin === "https://console.invalid"
      ? `${target.pathname}${target.search}${target.hash}`
      : "/";
  } catch {
    return "/";
  }
}

export function LoginForm({
  onAuthenticated = (returnPath) => window.location.assign(returnPath),
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      if (!response.ok) {
        setError(GENERIC_LOGIN_ERROR);
        return;
      }

      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      onAuthenticated(resolveSafeReturnPath(returnTo));
    } catch {
      setError(GENERIC_LOGIN_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="login-email">Email address</label>
      <input
        id="login-email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
        disabled={submitting}
        required
      />

      <label htmlFor="login-password">Password</label>
      <input
        id="login-password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.currentTarget.value)}
        disabled={submitting}
        required
      />

      {error === null ? null : <p role="alert">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
