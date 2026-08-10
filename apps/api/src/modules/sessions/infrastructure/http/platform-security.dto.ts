import { ApiProperty } from "@nestjs/swagger";

export class PlatformSessionRevocationRequestDto {
  @ApiProperty({ type: String, minLength: 1, maxLength: 160 })
  reason!: string;
}

export class PlatformSessionRevocationResponseDto {
  @ApiProperty({ type: String, format: "uuid" })
  userId!: string;

  @ApiProperty({ type: Number, minimum: 0 })
  revokedSessionCount!: number;
}
