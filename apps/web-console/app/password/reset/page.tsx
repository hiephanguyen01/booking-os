import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@booking-os/ui/card";

import { PasswordResetForm } from "../../../src/components/identity-forms";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Booking OS
          </p>
          <CardTitle id="reset-password-title">Reset your password</CardTitle>
          <CardDescription>Choose a new password to secure your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordResetForm />
        </CardContent>
      </Card>
    </main>
  );
}
