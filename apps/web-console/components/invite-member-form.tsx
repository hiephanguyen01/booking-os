"use client";

import { Alert } from "@booking-os/ui/alert";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { readProblemMessage } from "./problem-message";

const DEFAULT_ROLE = "tenant_admin" as const;
const INVITATION_EXPIRY_LABEL = "24 hours" as const;
const inviteMemberSchema = z.object({
  email: z.string().email("Enter a valid administrator email address."),
});

type InviteMemberValues = z.infer<typeof inviteMemberSchema>;

interface InviteMemberFormProps {
  readonly tenantId: string;
  readonly onInvited?: () => void;
}

export function InviteMemberForm({ tenantId, onInvited }: InviteMemberFormProps) {
  const [message, setMessage] = useState<{
    readonly state: "success" | "error";
    readonly text: string;
  } | null>(null);
  const form = useForm<InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setMessage(null);
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: values.email }),
        cache: "no-store",
      });
      if (!response.ok) {
        setMessage({ state: "error", text: await readProblemMessage(response) });
        return;
      }

      form.reset();
      setMessage({ state: "success", text: "Invitation queued for delivery." });
      onInvited?.();
    } catch {
      setMessage({
        state: "error",
        text: "NETWORK_ERROR: Booking OS could not create the invitation.",
      });
    }
  });

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <FormField
        id="member-email"
        label="Administrator email"
        {...(form.formState.errors.email?.message
          ? { error: form.formState.errors.email.message }
          : {})}
      >
        {(accessibility) => (
          <Input
            id="member-email"
            type="email"
            autoComplete="email"
            placeholder="admin@example.com"
            {...form.register("email")}
            {...accessibility}
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="member-role" label="Role" description="Task 8 supports tenant admins only.">
          {(accessibility) => (
            <Input
              id="member-role"
              value={DEFAULT_ROLE}
              readOnly
              aria-readonly="true"
              {...accessibility}
            />
          )}
        </FormField>
        <FormField id="invitation-expiry" label="Invitation expiry">
          {(accessibility) => (
            <Input
              id="invitation-expiry"
              value={INVITATION_EXPIRY_LABEL}
              readOnly
              aria-readonly="true"
              {...accessibility}
            />
          )}
        </FormField>
      </div>

      {message ? (
        <Alert variant={message.state === "success" ? "success" : "destructive"}>
          {message.text}
        </Alert>
      ) : null}

      <SubmitButton
        idleLabel="Invite administrator"
        pendingLabel="Sending invitation…"
        pending={form.formState.isSubmitting}
      />
    </form>
  );
}
