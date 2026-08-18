import { PERMISSION_KEYS, type PermissionKey } from "@booking-os/auth";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const TENANT_PERMISSION_KEYS = Object.values(PERMISSION_KEYS).filter((key) =>
  key.startsWith("tenant."),
);

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
  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: TENANT_PERMISSION_KEYS, isArray: true })
  permissionKeys!: PermissionKey[];
}

export class UpdateTenantCustomRoleRequestDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;
}

export class ReplaceTenantCustomRolePermissionsRequestDto {
  @ApiProperty({ enum: TENANT_PERMISSION_KEYS, isArray: true })
  permissionKeys!: PermissionKey[];

  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;
}

export class ArchiveTenantCustomRoleRequestDto {
  @ApiProperty({ type: Number, minimum: 1 })
  expectedVersion!: number;
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
