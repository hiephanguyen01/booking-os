const DEFAULT_PLAYWRIGHT_DATABASE_URL =
  "postgresql://booking:booking@127.0.0.1:5432/booking_os_test";

export default function configurePlaywrightWorkerEnvironment(): void {
  process.env.PLAYWRIGHT_DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_PLAYWRIGHT_DATABASE_URL;
}
