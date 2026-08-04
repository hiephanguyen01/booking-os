import { HEALTH_STATUSES } from "@booking-os/contracts/health";
import { ApiProperty, ApiPropertyOptional, getSchemaPath } from "@nestjs/swagger";

export class HealthDependencyStatusDto {
  @ApiProperty({ enum: HEALTH_STATUSES })
  status!: (typeof HEALTH_STATUSES)[number];

  @ApiPropertyOptional({ minimum: 0, type: Number })
  latencyMs?: number;

  @ApiPropertyOptional({ type: String })
  message?: string;
}

export class HealthResponseDto {
  @ApiProperty({ type: String })
  service!: string;

  @ApiProperty({ enum: HEALTH_STATUSES })
  status!: (typeof HEALTH_STATUSES)[number];

  @ApiProperty({ type: String })
  version!: string;

  @ApiProperty({ format: "date-time", type: String })
  timestamp!: string;

  @ApiProperty({ minimum: 0, type: Number })
  uptimeSeconds!: number;

  @ApiPropertyOptional({
    additionalProperties: { $ref: getSchemaPath(HealthDependencyStatusDto) },
    type: "object",
  })
  dependencies?: Record<string, HealthDependencyStatusDto>;
}
