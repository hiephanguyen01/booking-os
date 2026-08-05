import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

export function Input({ className, ref, ...props }: ComponentProps<"input">) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
