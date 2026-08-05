import type { ComponentProps } from "react";

import { cn } from "../lib/cn";

export function Label({ className, children, htmlFor, ref, ...props }: ComponentProps<"label">) {
  return (
    <label ref={ref} htmlFor={htmlFor} className={cn("text-sm font-medium", className)} {...props}>
      {children}
    </label>
  );
}
