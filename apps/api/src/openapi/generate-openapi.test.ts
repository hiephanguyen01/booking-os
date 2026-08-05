import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function reservePort(): Promise<{
  readonly close: () => Promise<void>;
  readonly port: number;
}> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    port: address.port,
  };
}

test("generates the contract without binding a port or reaching infrastructure", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "booking-os-openapi-"));
  const outputPath = join(temporaryDirectory, "openapi.json");
  const apiRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const reservedPort = await reservePort();

  try {
    const result = spawnSync("pnpm", ["openapi:generate"], {
      cwd: apiRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        API_PREFIX: "api",
        DATABASE_URL: "postgresql://booking:booking@127.0.0.1:1/booking_os_openapi",
        NODE_ENV: "test",
        OPENAPI_OUTPUT_PATH: outputPath,
        PAYMENT_PROVIDER: "mock",
        PORT: String(reservedPort.port),
        REDIS_URL: "redis://127.0.0.1:1/15",
        SESSION_SECRET: "openapi-generation-only-secret-at-least-32-characters",
      },
      timeout: 30_000,
    });

    assert.equal(result.status, 0, `generator failed:\n${result.stdout}\n${result.stderr}`);
    const source = await readFile(outputPath, "utf8");
    const document = JSON.parse(source) as {
      readonly paths: Readonly<
        Record<string, Readonly<Record<string, { readonly operationId?: string }>>>
      >;
    };
    assert.deepEqual(Object.keys(document.paths), [
      "/api/auth/activation/complete",
      "/api/auth/csrf",
      "/api/auth/password/forgot",
      "/api/auth/password/reset",
      "/api/health",
      "/api/ready",
    ]);
    assert.deepEqual(
      Object.values(document.paths)
        .flatMap((pathItem) => Object.values(pathItem))
        .map((operation) => operation.operationId)
        .filter((operationId): operationId is string => operationId !== undefined)
        .sort(),
      [
        "completeAccountActivation",
        "completePasswordReset",
        "getHealth",
        "getPreAuthCsrf",
        "getReadiness",
        "requestPasswordReset",
      ],
    );
  } finally {
    await reservedPort.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});