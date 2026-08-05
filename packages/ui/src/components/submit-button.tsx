import { Button, type ButtonProps } from "./button";

interface SubmitButtonProps extends Omit<ButtonProps, "children" | "type"> {
  idleLabel: string;
  pendingLabel: string;
  pending?: boolean;
}

export function SubmitButton({
  idleLabel,
  pendingLabel,
  pending = false,
  disabled,
  ...props
}: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending} {...props}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
