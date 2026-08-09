import { ApiProperty } from "@nestjs/swagger";

export class ProvisionTenantRequestDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 63, example: "acme" })
  readonly slug!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 160, example: "Acme Ltd" })
  readonly tenantName!: string;

  @ApiProperty({ type: String, format: "email", example: "owner@example.com" })
  readonly ownerEmail!: string;
}

export class TenantProvisioningResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  readonly tenantId!: string;

  @ApiProperty({ type: String })
  readonly tenantName!: string;

  @ApiProperty({ type: String })
  readonly slug!: string;

  @ApiProperty({ type: String, enum: ["provisioning"] })
  readonly status!: "provisioning";

  @ApiProperty({ type: String, format: "uuid" })
  readonly ownerMembershipId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  readonly ownerInvitationId!: string;

  @ApiProperty({ type: Boolean })
  readonly replayed?: boolean;
}

export class OwnerInvitationResendResponseDto {
  @ApiProperty({ type: Boolean, example: true })
  readonly accepted!: true;
}
