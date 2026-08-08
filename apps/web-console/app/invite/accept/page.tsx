import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@booking-os/ui/card";

import { InvitationAcceptForm } from "../../../components/invitation-accept-form";

export default function InvitationAcceptPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Booking OS
          </p>
          <CardTitle>Accept tenant invitation</CardTitle>
          <CardDescription>
            The invitation token is consumed from the URL fragment and removed from browser history
            before submission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitationAcceptForm />
        </CardContent>
      </Card>
    </main>
  );
}
