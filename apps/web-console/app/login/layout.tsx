import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function LoginLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
