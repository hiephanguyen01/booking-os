import { SetMetadata } from "@nestjs/common";

export const TENANT_REQUIRED_METADATA = "booking-os:tenant-required";

export const TenantRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_REQUIRED_METADATA, true);
