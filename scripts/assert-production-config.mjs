import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const evaluation = `
  import { environmentSchema } from "./src/config/environment.schema.ts";
  const result = environmentSchema.safeParse(process.env);
  if (result.success) {
    process.exit(0);
  }
  console.error(JSON.stringify(result.error.issues));
  process.exit(2);
`;
const result = spawnSync("pnpm", ["--filter", "@booking-os/api", "exec", "tsx", "-e", evaluation], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "3001",
    API_PREFIX: "api",
    TENANT_BASE_DOMAIN: "example.com",
    DATABASE_URL: "postgresql://booking:booking@127.0.0.1:5432/booking_os_guard",
    REDIS_URL: "redis://127.0.0.1:6379/1",
    SESSION_SECRET: "production-guard-session-secret-at-least-32-characters",
    PAYMENT_PROVIDER: "mock",
    IDENTITY_TOKEN_PEPPER: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
    IDENTITY_ENVELOPE_KEYS: '{"identity-v1":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="}',
    IDENTITY_ACTIVE_ENVELOPE_KEY_ID: "identity-v1",
    IDENTITY_BOOTSTRAP_ENABLED: "false",
  },
  encoding: "utf8",
});

if (result.error) {
  throw result.error;
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

if (result.status === 0) {
  throw new Error("Production configuration accepted PAYMENT_PROVIDER=mock.");
}

if (!output.includes("PAYMENT_PROVIDER cannot be mock in production")) {
  process.stderr.write(output);
  throw new Error("Production configuration failed for an unexpected reason.");
}

console.log("Production configuration guard PASS: mock payments are rejected.");
