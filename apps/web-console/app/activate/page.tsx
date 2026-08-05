import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@booking-os/ui/card";

import { ActivationForm } from "../../src/components/identity-forms";

export default function ActivatePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Booking OS
          </p>
          <CardTitle id="activation-title">Activate your account</CardTitle>
          <CardDescription>
            Choose a secure password to finish activating your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivationForm />
        </CardContent>
      </Card>
    </main>
  );
}
