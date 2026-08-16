import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function PasswordLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
