import { SetMetadata } from "@nestjs/common";

export const SESSION_REQUIRED_METADATA = "booking-os:session-required";

export const SessionRequired = () => SetMetadata(SESSION_REQUIRED_METADATA, true);
