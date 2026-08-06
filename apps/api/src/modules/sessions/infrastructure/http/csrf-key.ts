import { createHash } from "node:crypto";

const SESSION_CSRF_ROOT_LABEL = "booking-os/session-csrf-root/v1";

export function deriveSessionCsrfKey(sessionSecret: string): Uint8Array {
  return createHash("sha256")
    .update(`${SESSION_CSRF_ROOT_LABEL}\0`, "utf8")
    .update(sessionSecret, "utf8")
    .digest();
}
