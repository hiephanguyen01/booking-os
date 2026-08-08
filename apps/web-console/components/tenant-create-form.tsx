"use client";

import { Alert } from "@booking-os/ui/alert";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { readProblemMessage } from "./problem-message";

const tenantCreateSchema = z.object({
  slug: z
    .string()
    .min(1, "Tenant slug is required.")
    .max(63, "Tenant slug must be 63 characters or fewer.")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Use lowercase letters, numbers, and single hyphens."),
  tenantName: z
    .string()
    .min(1, "Tenant name is required.")
    .max(160, "Tenant name must be 160 characters or fewer."),
  ownerEmail: z.string().email("Enter a valid owner email address."),
});

type TenantCreateValues = z.infer<typeof tenantCreateSchema>;

export function TenantCreateForm() {
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const form = useForm<TenantCreateValues>({
    resolver: zodResolver(tenantCreateSchema),
    defaultValues: {
      slug: "",
      tenantName: "",
      ownerEmail: "",
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const response = await fetch("/api/platform/tenants", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey.current,
        },
        body: JSON.stringify(values),
        cache: "no-store",
      });
      if (!response.ok) {
        setError(await readProblemMessage(response));
        return;
      }

      const payload = (await response.json()) as { tenantId?: unknown };
      if (typeof payload.tenantId !== "string") {
        setError("INVALID_RESPONSE: Tenant provisioning did not return a tenant identifier.");
        return;
      }
      window.location.assign(`/platform/status?tenantId=${encodeURIComponent(payload.tenantId)}`);
    } catch {
      setError("NETWORK_ERROR: Booking OS could not reach the provisioning service.");
    }
  });

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <FormField
        id="tenant-slug"
        label="Tenant slug"
        description="Lowercase URL-safe identifier, for example acme-studio."
        {...(form.formState.errors.slug?.message
          ? { error: form.formState.errors.slug.message }
          : {})}
      >
        {(accessibility) => (
          <Input
            id="tenant-slug"
            autoComplete="off"
            placeholder="acme-studio"
            {...form.register("slug")}
            {...accessibility}
          />
        )}
      </FormField>

      <FormField
        id="tenant-name"
        label="Tenant name"
        {...(form.formState.errors.tenantName?.message
          ? { error: form.formState.errors.tenantName.message }
          : {})}
      >
        {(accessibility) => (
          <Input
            id="tenant-name"
            autoComplete="organization"
            placeholder="Acme Studio"
            {...form.register("tenantName")}
            {...accessibility}
          />
        )}
      </FormField>

      <FormField
        id="owner-email"
        label="Initial owner email"
        {...(form.formState.errors.ownerEmail?.message
          ? { error: form.formState.errors.ownerEmail.message }
          : {})}
      >
        {(accessibility) => (
          <Input
            id="owner-email"
            type="email"
            autoComplete="email"
            placeholder="owner@example.com"
            {...form.register("ownerEmail")}
            {...accessibility}
          />
        )}
      </FormField>

      {error ? <Alert variant="destructive">{error}</Alert> : null}

      <SubmitButton
        idleLabel="Create tenant"
        pendingLabel="Creating tenant…"
        pending={form.formState.isSubmitting}
      />
    </form>
  );
}
