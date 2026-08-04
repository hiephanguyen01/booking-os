import { defineConfig, devices } from "@playwright/test";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://booking:booking@127.0.0.1:5432/booking_os_test";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/1";
const apiBaseUrl = "http://127.0.0.1:3001/api";
const reuseExistingServer = process.env.CI !== "true";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      name: "api",
      command:
        "pnpm --filter @booking-os/api prisma:migrate:deploy && pnpm --filter @booking-os/api prisma:seed && pnpm --filter @booking-os/api dev",
      url: `${apiBaseUrl}/ready`,
      reuseExistingServer,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: "3001",
        API_PREFIX: "api",
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        SESSION_SECRET: "e2e-only-session-secret-at-least-32-characters",
        PAYMENT_PROVIDER: "mock",
      },
    },
    {
      name: "storefront",
      command: "pnpm --filter @booking-os/web-storefront dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        API_BASE_URL: apiBaseUrl,
        APP_LOCALE: "en",
      },
    },
    {
      name: "console",
      command: "pnpm --filter @booking-os/web-console dev",
      url: "http://127.0.0.1:3002",
      reuseExistingServer,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        API_BASE_URL: apiBaseUrl,
        APP_LOCALE: "en",
      },
    },
  ],
});
