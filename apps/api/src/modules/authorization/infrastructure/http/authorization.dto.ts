import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AuthorizationScopeDto {
  @ApiProperty({ enum: ["platform", "tenant"] })
  type!: "platform" | "tenant";

  @ApiPropertyOptional({ type: String, format: "uuid" })
  tenantId?: string;

  @ApiPropertyOptional({ type: String })
  tenantSlug?: string;
}

export class AuthorizationContextResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  userId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  sessionId!: string;

  @ApiProperty({ type: AuthorizationScopeDto })
  scope!: AuthorizationScopeDto;

  @ApiPropertyOptional({ type: String, format: "uuid" })
  membershipId?: string;

  @ApiPropertyOptional({ enum: ["active"] })
  membershipStatus?: "active";

  @ApiProperty({ type: [String] })
  roleKeys!: string[];

  @ApiProperty({ type: [String] })
  permissionKeys!: string[];

  @ApiProperty({ type: Number, minimum: 1 })
  userAuthorizationVersion!: number;

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  membershipAuthorizationVersion?: number;
}
