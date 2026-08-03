import type { Metadata } from "next";
import type { ReactNode } from "react";

import { resolveAppConfig } from "../src/app-config.js";
import "./globals.css";

export const metadata: Metadata = {
  title: "Booking OS Console",
  description: "Operations console shell for Booking OS.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { locale } = resolveAppConfig();

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
