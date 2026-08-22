import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface OpenApiOperation {
  readonly requestBody?: {
    readonly content?: {
      readonly "application/json"?: {
        readonly schema?: { readonly $ref?: string };
      };
    };
  };
  readonly responses?: Record<string, unknown>;
}

interface OpenApiDocument {
  readonly paths?: Record<string, Record<string, OpenApiOperation | undefined>>;
}

async function readCommittedOpenApi(): Promise<OpenApiDocument> {
  const path = new URL("../../../../packages/contracts/openapi/openapi.json", import.meta.url);
  return JSON.parse(await readFile(path, "utf8")) as OpenApiDocument;
}

function operation(
  document: OpenApiDocument,
  path: string,
  method: "post" | "patch" | "put" | "delete",
): OpenApiOperation {
  const result = document.paths?.[path]?.[method];
  assert.ok(result, `${method.toUpperCase()} ${path} must exist in the committed OpenAPI contract`);
  return result;
}

function assertJsonBody(operation: OpenApiOperation, schemaName: string): void {
  assert.equal(
    operation.requestBody?.content?.["application/json"]?.schema?.$ref,
    `#/components/schemas/${schemaName}`,
  );
}

test("Tenant RBAC OpenAPI matches runtime mutation status and request bodies", async () => {
  const document = await readCommittedOpenApi();

  const create = operation(document, "/api/tenant/rbac/roles", "post");
  assert.ok(create.responses?.["201"], "create role must document the runtime HTTP 201 response");
  assert.equal(create.responses?.["200"], undefined);
  assertJsonBody(create, "CreateTenantCustomRoleRequestDto");

  assertJsonBody(
    operation(document, "/api/tenant/rbac/roles/{roleId}", "patch"),
    "UpdateTenantCustomRoleRequestDto",
  );
  assertJsonBody(
    operation(document, "/api/tenant/rbac/roles/{roleId}/permissions", "put"),
    "ReplaceTenantCustomRolePermissionsRequestDto",
  );
  assertJsonBody(
    operation(document, "/api/tenant/rbac/roles/{roleId}", "delete"),
    "ArchiveTenantCustomRoleRequestDto",
  );
});
