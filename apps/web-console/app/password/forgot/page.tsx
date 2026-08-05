import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@booking-os/ui/card";

import { ForgotPasswordForm } from "../../../src/components/identity-forms";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Booking OS
          </p>
          <CardTitle id="forgot-password-title">Forgot your password?</CardTitle>
          <CardDescription>
            Request a password reset link without revealing whether an account exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
