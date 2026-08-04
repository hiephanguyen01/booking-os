import { SetMetadata } from "@nestjs/common";

export const SUPPORTED_API_METADATA = "booking-os:supported-api";
export const INTERNAL_API_METADATA = "booking-os:internal-api";

export type ApiVisibility = "public-supported" | "internal";

export function SupportedApi(): ClassDecorator & MethodDecorator {
  return SetMetadata(SUPPORTED_API_METADATA, true);
}

export function InternalApi(): ClassDecorator & MethodDecorator {
  return SetMetadata(INTERNAL_API_METADATA, true);
}
