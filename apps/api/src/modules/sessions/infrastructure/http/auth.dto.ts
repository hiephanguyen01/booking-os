import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const PUBLIC_SESSION_STATES = ["active", "invitation_pending"] as const;
const SESSION_STATES = ["active", "invitation_pending", "compromised", "revoked"] as const;
const SESSION_SCOPE_TYPES = ["platform", "tenant"] as const;

export class LoginRequestDto {
  @ApiProperty({ type: String, format: "email" })
  readonly email!: string;

  @ApiProperty({ type: String, minLength: 1, writeOnly: true })
  readonly password!: string;
}

export class SessionScopeDto {
  @ApiProperty({ type: String, enum: SESSION_SCOPE_TYPES })
  readonly type!: (typeof SESSION_SCOPE_TYPES)[number];

  @ApiPropertyOptional({ type: String, format: "uuid" })
  readonly tenantId?: string;
}

export class PublicSessionDto {
  @ApiProperty({ type: String, format: "uuid" })
  readonly id!: string;

  @ApiProperty({ type: String, enum: PUBLIC_SESSION_STATES })
  readonly state!: (typeof PUBLIC_SESSION_STATES)[number];

  @ApiProperty({ type: () => SessionScopeDto })
  readonly scope!: SessionScopeDto;
}

export class SessionResponseDto {
  @ApiProperty({ type: () => PublicSessionDto })
  readonly session!: PublicSessionDto;
}

export class LogoutResponseDto {
  @ApiProperty({ type: Boolean, example: true })
  readonly loggedOut!: boolean;
}

export class ActorDto {
  @ApiProperty({ type: String, format: "uuid" })
  readonly id!: string;
}

export class CurrentAuthenticationResponseDto {
  @ApiProperty({ type: () => ActorDto })
  readonly actor!: ActorDto;

  @ApiProperty({ type: () => PublicSessionDto })
  readonly session!: PublicSessionDto;
}

export class SessionSummaryDto {
  @ApiProperty({ type: String, format: "uuid" })
  readonly id!: string;

  @ApiProperty({ type: () => SessionScopeDto })
  readonly scope!: SessionScopeDto;

  @ApiProperty({ type: String })
  readonly hostname!: string;

  @ApiProperty({ type: String, enum: SESSION_STATES })
  readonly state!: (typeof SESSION_STATES)[number];

  @ApiProperty({ type: Boolean })
  readonly current!: boolean;

  @ApiProperty({ type: String, format: "date-time" })
  readonly createdAt!: string;

  @ApiProperty({ type: String, format: "date-time" })
  readonly lastSeenAt!: string;

  @ApiProperty({ type: String, format: "date-time" })
  readonly idleExpiresAt!: string;

  @ApiProperty({ type: String, format: "date-time" })
  readonly absoluteExpiresAt!: string;
}

export class SessionListResponseDto {
  @ApiProperty({ isArray: true, type: () => SessionSummaryDto })
  readonly sessions!: readonly SessionSummaryDto[];
}

export class RevokeDeviceResponseDto {
  @ApiProperty({ type: Boolean })
  readonly revoked!: boolean;
}

export class RevokeOtherSessionsResponseDto {
  @ApiProperty({ type: Number, minimum: 0 })
  readonly revokedCount!: number;
}
