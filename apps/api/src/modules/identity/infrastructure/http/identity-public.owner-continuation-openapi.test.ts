import assert from "node:assert/strict";
import test from "node:test";

import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { OpenAPIObject, ResponseObject, SchemaObject } from "@nestjs/swagger";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import { createSupportedOpenApiDocument } from "../../../../openapi/openapi-document.js";
import { IdentityPublicController } from "./identity-public.controller.js";
import { NestIdentityPublicController } from "./identity-public.nest.controller.js";

const CORE_CONTROLLER_STUB = {
  getCsrf: () => ({ csrfToken: "proof", expiresAt: "2026-08-17T02:00:00.000Z" }),
  completeActivation: async () => ({
    completed: true as const,
    continuationEmail: "owner@example.test",
  }),
  requestPasswordReset: async () => ({ accepted: true as const }),
  completePasswordReset: async () => ({ completed: true as const }),
};

@Module({
  imports: [DiscoveryModule],
  controllers: [NestIdentityPublicController],
  providers: [
    { provide: IdentityPublicController, useValue: CORE_CONTROLLER_STUB },
    {
      provide: EnvironmentService,
      useValue: { trustProxy: false, platformHostname: "platform.example.test" },
    },
    RequestContextStorage,
  ],
})
class IdentityOwnerContinuationOpenApiTestModule {}

function responseSchema(
  document: OpenAPIObject,
  path: string,
): SchemaObject {
  const response = document.paths[path]?.post?.responses?.["200"] as ResponseObject | undefined;
  const schema = response?.content?.["application/json"]?.schema as SchemaObject | undefined;
  assert.ok(schema, `expected a 200 application/json schema for ${path}`);

  if ("$ref" in schema && typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").at(-1);
    assert.ok(name, `expected a component schema reference for ${path}`);
    const component = document.components?.schemas?.[name] as SchemaObject | undefined;
    assert.ok(component, `expected component schema ${name}`);
    return component;
  }

  return schema;
}

test("documents continuationEmail only on account activation responses", async () => {
  const module = await Test.createTestingModule({
    imports: [IdentityOwnerContinuationOpenApiTestModule],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  try {
    const document = createSupportedOpenApiDocument(app, "api");
    const activation = responseSchema(document, "/api/auth/activation/complete");
    const passwordReset = responseSchema(document, "/api/auth/password/reset");

    assert.deepEqual(activation.properties?.continuationEmail, {
      type: "string",
      format: "email",
    });
    assert.equal(activation.required?.includes("continuationEmail"), false);
    assert.equal(passwordReset.properties?.continuationEmail, undefined);
  } finally {
    await app.close();
  }
});
