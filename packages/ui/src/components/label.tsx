import type { ComponentProps } from "react";

import { cn } from "../lib/cn.js";

export function Label({ className, ref, ...props }: ComponentProps<"label">) {
  return <label ref={ref} className={cn("text-sm font-medium", className)} {...props} />;
}
