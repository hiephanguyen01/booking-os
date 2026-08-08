"use client";

import { Alert } from "@booking-os/ui/alert";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { useEffect, useRef, useState } from "react";

import { consumeIdentityTokenFragment } from "../src/lib/identity/fragment-token";
import { readProblemMessage } from "./problem-message";

export function InvitationAcceptForm() {
  const consumed = useRef(false);
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    setToken(consumeIdentityTokenFragment(window.location, window.history));
  }, []);

  async function acceptInvitation() {
    if (!token) {
      setError("INVALID_INVITATION_LINK: This invitation link is invalid or incomplete.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        setError(await readProblemMessage(response));
        return;
      }
      window.location.assign("/settings/members");
    } catch {
      setError("NETWORK_ERROR: Booking OS could not accept this invitation.");
    } finally {
      setPending(false);
    }
  }

  const missingToken = token === null;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Accepting this invitation activates your tenant membership and refreshes your tenant session.
      </p>
      {missingToken ? (
        <Alert variant="destructive">
          INVALID_INVITATION_LINK: This invitation link is invalid or incomplete.
        </Alert>
      ) : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <SubmitButton
        idleLabel="Accept invitation"
        pendingLabel="Accepting invitation…"
        pending={pending || token === undefined}
        disabled={missingToken}
        onClick={acceptInvitation}
      />
    </div>
  );
}
