import type { IncomingHttpHeaders } from "node:http";

import type { RequestIdGenerator } from "./tokens.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function selectRequestId(
  header: IncomingHttpHeaders["x-request-id"],
  generate: RequestIdGenerator,
): string {
  const candidate = Array.isArray(header) ? header[0] : header;

  return isValidRequestId(candidate) ? candidate : generate();
}
