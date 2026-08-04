import "reflect-metadata";

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NestFactory } from "@nestjs/core";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://booking:booking@127.0.0.1:1/booking_os_openapi";
process.env.REDIS_URL ??= "redis://127.0.0.1:1/15";
process.env.SESSION_SECRET ??= "openapi-generation-only-secret-at-least-32-characters";
process.env.PAYMENT_PROVIDER ??= "mock";

const canonicalOutputPath = fileURLToPath(
  new URL("../../../../packages/contracts/openapi/openapi.json", import.meta.url),
);

async function generateOpenApi(): Promise<void> {
  const [{ AppModule }, { EnvironmentService }, { createSupportedOpenApiDocument, serializeOpenApiDocument }] =
    await Promise.all([
      import("../app.module.js"),
      import("../config/environment.service.js"),
      import("./openapi-document.js"),
    ]);
  const outputPath = resolve(process.env.OPENAPI_OUTPUT_PATH ?? canonicalOutputPath);
  const app = await NestFactory.create(AppModule, { logger: false });

  try {
    const environment = app.get(EnvironmentService);
    app.setGlobalPrefix(environment.apiPrefix);
    await app.init();

    const document = createSupportedOpenApiDocument(app, environment.apiPrefix);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serializeOpenApiDocument(document), "utf8");
  } finally {
    await app.close();
  }
}

generateOpenApi().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown OpenAPI generation failure";
  process.stderr.write(`OpenAPI generation failed: ${message}\n`);
  process.exitCode = 1;
});
