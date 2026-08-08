import { ApiProperty } from "@nestjs/swagger";

export class TenantMembershipResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String, format: "uuid" })
  userId!: string;

  @ApiProperty({ enum: ["invited", "active", "suspended", "revoked"] })
  status!: "invited" | "active" | "suspended" | "revoked";

  @ApiProperty({ type: Number, minimum: 1 })
  authorizationVersion!: number;

  @ApiProperty({ enum: ["tenant_owner", "tenant_admin"], isArray: true })
  roleKeys!: Array<"tenant_owner" | "tenant_admin">;
}

export class TenantMembershipLifecycleMutationResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  membershipId!: string;

  @ApiProperty({ enum: ["suspended", "revoked"] })
  status!: "suspended" | "revoked";

  @ApiProperty({ type: Number, minimum: 1 })
  authorizationVersion!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  revokedSessionCount!: number;
}

export class TenantMembershipRoleMutationResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  membershipId!: string;

  @ApiProperty({ enum: ["tenant_owner", "tenant_admin"] })
  roleKey!: "tenant_owner" | "tenant_admin";

  @ApiProperty({ type: Number, minimum: 1 })
  authorizationVersion!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  revokedSessionCount!: number;
}
