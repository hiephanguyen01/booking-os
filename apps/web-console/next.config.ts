import type { NextConfig } from "next";

const AUTH_SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
  { key: "Cache-Control", value: "no-store" },
] as const;

const AUTH_PAGE_SOURCES = ["/login", "/activate/:path*", "/password/:path*", "/invite/:path*"];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.booking.localhost"],
  transpilePackages: ["@booking-os/ui"],
  headers: async () =>
    AUTH_PAGE_SOURCES.map((source) => ({
      source,
      headers: [...AUTH_SECURITY_HEADERS],
    })),
};

export default nextConfig;
