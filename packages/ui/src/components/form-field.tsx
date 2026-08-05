import type { ReactNode } from "react";

import { Label } from "./label";

type ControlAccessibilityProps = {
  "aria-describedby"?: string;
  "aria-invalid": boolean;
};

interface FormFieldProps {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: (props: ControlAccessibilityProps) => ReactNode;
}

export function FieldError({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className="text-sm text-destructive" role="alert">
      {children}
    </p>
  );
}

export function FormField({ id, label, description, error, children }: FormFieldProps) {
  const describedBy = [description && `${id}-description`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");
  const accessibilityProps: ControlAccessibilityProps = {
    "aria-invalid": Boolean(error),
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children(accessibilityProps)}
      {description ? (
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <div id={`${id}-error`}>
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
    </div>
  );
}
