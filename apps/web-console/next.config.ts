import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.booking.localhost"],
  transpilePackages: ["@booking-os/ui"],
};

export default nextConfig;
