import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface StringSchema {
  readonly type?: string;
  readonly enum?: readonly string[];
  readonly "x-extensible-enum"?: readonly string[];
}

interface ArraySchema {
  readonly type?: string;
  readonly items?: StringSchema;
}

interface ObjectSchema {
  readonly properties?: Readonly<Record<string, StringSchema | ArraySchema>>;
}

interface OpenApiDocument {
  readonly components?: {
    readonly schemas?: Readonly<Record<string, ObjectSchema>>;
  };
}

const document = JSON.parse(
  await readFile(new URL("../openapi/openapi.json", import.meta.url), "utf8"),
) as OpenApiDocument;

const schemas = document.components?.schemas ?? {};

function property(schemaName: string, propertyName: string): StringSchema | ArraySchema {
  const value = schemas[schemaName]?.properties?.[propertyName];
  assert.ok(value, `${schemaName}.${propertyName} must exist`);
  return value;
}

test("Tenant RBAC response permission keys are extensible while request keys stay closed", () => {
  const permissionKey = property("TenantRbacPermissionResponseDto", "key") as StringSchema;
  assert.equal(permissionKey.type, "string");
  assert.equal(permissionKey.enum, undefined);
  assert.ok(permissionKey["x-extensible-enum"]?.includes("tenant.rbac.role.read"));
  assert.ok(permissionKey["x-extensible-enum"]?.includes("tenant.partner.read"));

  const rolePermissionKeys = property(
    "TenantCustomRoleResponseDto",
    "permissionKeys",
  ) as ArraySchema;
  assert.equal(rolePermissionKeys.type, "array");
  assert.equal(rolePermissionKeys.items?.type, "string");
  assert.equal(rolePermissionKeys.items?.enum, undefined);
  assert.ok(rolePermissionKeys.items?.["x-extensible-enum"]?.includes("tenant.partner.read"));

  for (const schemaName of [
    "CreateTenantCustomRoleRequestDto",
    "ReplaceTenantCustomRolePermissionsRequestDto",
  ]) {
    const requestPermissionKeys = property(schemaName, "permissionKeys") as ArraySchema;
    assert.equal(requestPermissionKeys.type, "array");
    assert.ok(requestPermissionKeys.items?.enum?.includes("tenant.rbac.role.read"));
    assert.ok(requestPermissionKeys.items?.enum?.includes("tenant.partner.read"));
    assert.equal(requestPermissionKeys.items?.["x-extensible-enum"], undefined);
  }
});
