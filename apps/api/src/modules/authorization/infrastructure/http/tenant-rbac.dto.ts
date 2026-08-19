import { PERMISSION_KEYS, type PermissionKey } from "@booking-os/auth";
import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { z } from "zod";

const TENANT_PERMISSION_KEYS = Object.values(PERMISSION_KEYS).filter((key) =>
  key.startsWith("tenant."),
);
const ROLE_NAME_MAX_LENGTH = 100;
const ROLE_DESCRIPTION_MAX_LENGTH = 500;

const tenantPermissionKeySchema = z.custom<PermissionKey>(
  (value) => typeof value === "string" && TENANT_PERMISSION_KEYS.includes(value as PermissionKey),
  { message: "permission key must be tenant-scoped" },
);

const expectedVersionSchema = z.number().int().min(1);
const roleNameSchema = z.string().trim().min(1).max(ROLE_NAME_MAX_LENGTH);
const roleDescriptionSchema = z.string().trim().max(ROLE_DESCRIPTION_MAX_LENGTH).nullable();

const createTenantCustomRoleRequestSchema = z
  .object({
    name: roleNameSchema,
    description: roleDescriptionSchema.optional().default(null),
    permissionKeys: z
      .array(tenantPermissionKeySchema)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: "permissionKeys must not contain duplicates",
      }),
  })
  .strict();

const updateTenantCustomRoleRequestSchema = z
  .object({
    name: roleNameSchema,
    description: roleDescriptionSchema,
    expectedVersion: expectedVersionSchema,
  })
  .strict();

const replaceTenantCustomRolePermissionsRequestSchema = z
  .object({
    permissionKeys: z
      .array(tenantPermissionKeySchema)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: "permissionKeys must not contain duplicates",
      }),
    expectedVersion: expectedVersionSchema,
  })
  .strict();

const archiveTenantCustomRoleRequestSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
  })
  .strict();

function parseRequestBody<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({
      code: "INVALID_REQUEST_BODY",
      message: "Tenant RBAC request body is invalid.",
    });
  }
  return result.data;
}

export class TenantRbacPermissionResponseDto {
  @ApiProperty({ enum: TENANT_PERMISSION_KEYS })
  key!: PermissionKey;

  @ApiProperty({ enum: ["tenant"] })
  scopeLevel!: "tenant";

  @ApiProperty({ type: Boolean })
  delegable!: boolean;

  @ApiProperty({ type: String })
  description!: string;
}

export class TenantCustomRoleResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, format: "uuid" })
  tenantId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  normalizedName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: Number, minimum: 1 })
  version!: number;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  archivedAt!: Date | null;

  @ApiProperty({ enum: TENANT_PERMISSION_KEYS, isArray: true })
  permissionKeys!: PermissionKey[];
}

export class CreateTenantCustomRoleRequestDto {
  @ApiProperty({ type: String, maxLength: ROLE_NAME_MAX_LENGTH })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: ROLE_DESCRIPTION_MAX_LENGTH })
  description!: string | null;

  @ApiProperty({ enum: TENANT_PERMISSION_KEYS, isArray: true, uniqueItems: true })
  permissionKeys!: PermissionKey[];
}

export function parseCreateTenantCustomRoleRequest(
  input: unknown,
): CreateTenantCustomRoleRequestDto {
  return parseRequestBody(createTenantCustomRoleRequestSchema, input);
}

export class UpdateTenantCustomRoleRequestDto {
  @ApiProperty({ type: String, maxLength: ROLE_NAME_MAX_LENGTH })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: ROLE_DESCRIPTION_MAX_LENGTH })
  description!: string | null;

  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;
}

export function parseUpdateTenantCustomRoleRequest(
  input: unknown,
): UpdateTenantCustomRoleRequestDto {
  return parseRequestBody(updateTenantCustomRoleRequestSchema, input);
}

export class ReplaceTenantCustomRolePermissionsRequestDto {
  @ApiProperty({ enum: TENANT_PERMISSION_KEYS, isArray: true, uniqueItems: true })
  permissionKeys!: PermissionKey[];

  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;
}

export function parseReplaceTenantCustomRolePermissionsRequest(
  input: unknown,
): ReplaceTenantCustomRolePermissionsRequestDto {
  return parseRequestBody(replaceTenantCustomRolePermissionsRequestSchema, input);
}

export class ArchiveTenantCustomRoleRequestDto {
  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;
}

export function parseArchiveTenantCustomRoleRequest(
  input: unknown,
): ArchiveTenantCustomRoleRequestDto {
  return parseRequestBody(archiveTenantCustomRoleRequestSchema, input);
}

export class TenantCustomRoleAssignmentResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, format: "uuid" })
  tenantId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  membershipId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  roleId!: string;

  @ApiProperty({ type: String, format: "date-time" })
  createdAt!: Date;

  @ApiPropertyOptional({ type: String, format: "date-time", nullable: true })
  revokedAt!: Date | null;
}
