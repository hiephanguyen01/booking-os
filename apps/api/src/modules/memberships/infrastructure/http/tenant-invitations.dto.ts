import { ApiProperty } from "@nestjs/swagger";

export class CreateTenantAdminInvitationRequestDto {
  @ApiProperty({ type: String, format: "email" })
  email!: string;
}

export class TenantInvitationAcceptedResponseDto {
  @ApiProperty({ enum: [true] })
  accepted!: true;
}

export class CurrentTenantInvitationResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  invitationId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  tenantId!: string;

  @ApiProperty({ enum: ["tenant_owner", "tenant_admin"] })
  intendedRoleKey!: "tenant_owner" | "tenant_admin";

  @ApiProperty({ type: String })
  hostname!: string;

  @ApiProperty({ type: String, format: "date-time" })
  expiresAt!: Date;
}
