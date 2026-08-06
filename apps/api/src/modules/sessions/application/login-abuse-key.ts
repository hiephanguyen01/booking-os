import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import type { LoginAttemptKey } from "./ports/login-abuse-protection.port.js";

const MINIMUM_HMAC_KEY_BYTES = 32;

function hmac(key: Uint8Array, purpose: string, value: string): string {
  return createHmac("sha256", key).update(`${purpose}\0${value}`, "utf8").digest("hex");
}

function ipv4Summary(address: string): string {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    throw new TypeError("Login source must be a valid IP address.");
  }
  return `ipv4:${String(octets[0])}.${String(octets[1])}.${String(octets[2])}.0/24`;
}

function ipv4TailHextets(value: string): number[] {
  const octets = value.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    throw new TypeError("Login source must be a valid IP address.");
  }
  return [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
}

function parseIpv6Section(section: string): number[] {
  if (section.length === 0) {
    return [];
  }

  const rawSegments = section.split(":");
  const values: number[] = [];
  for (const [index, segment] of rawSegments.entries()) {
    if (segment.includes(".")) {
      if (index !== rawSegments.length - 1) {
        throw new TypeError("Login source must be a valid IP address.");
      }
      values.push(...ipv4TailHextets(segment));
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(segment)) {
      throw new TypeError("Login source must be a valid IP address.");
    }
    values.push(Number.parseInt(segment, 16));
  }
  return values;
}

function expandIpv6(address: string): number[] {
  if (address.includes("%") || isIP(address) !== 6) {
    throw new TypeError("Login source must be a valid IP address.");
  }

  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) {
    throw new TypeError("Login source must be a valid IP address.");
  }

  const left = parseIpv6Section(halves[0] ?? "");
  const right = parseIpv6Section(halves[1] ?? "");
  if (halves.length === 1) {
    if (left.length !== 8) {
      throw new TypeError("Login source must be a valid IP address.");
    }
    return left;
  }

  const missing = 8 - left.length - right.length;
  if (missing < 1) {
    throw new TypeError("Login source must be a valid IP address.");
  }
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function ipv6Summary(address: string): string {
  const hextets = expandIpv6(address);
  hextets[3] = (hextets[3] ?? 0) & 0xff00;
  return `ipv6:${hextets
    .slice(0, 4)
    .map((value) => value.toString(16))
    .join(":")}::/56`;
}

function sourceSummary(ipAddress: string): string {
  const family = isIP(ipAddress);
  if (family === 4) {
    return ipv4Summary(ipAddress);
  }
  if (family === 6) {
    return ipv6Summary(ipAddress);
  }
  throw new TypeError("Login source must be a valid IP address.");
}

export interface DeriveLoginAttemptKeyInput {
  readonly hmacKey: Uint8Array;
  readonly normalizedEmail: string;
  readonly ipAddress: string;
}

export function deriveLoginAttemptKey(input: DeriveLoginAttemptKeyInput): LoginAttemptKey {
  if (input.hmacKey.byteLength < MINIMUM_HMAC_KEY_BYTES) {
    throw new RangeError("Login abuse HMAC keys must contain at least 32 bytes.");
  }

  const normalizedEmail = input.normalizedEmail.trim().toLowerCase();
  if (normalizedEmail.length === 0) {
    throw new TypeError("Login account identity cannot be empty.");
  }
  const summary = sourceSummary(input.ipAddress.trim());
  const accountDigest = hmac(input.hmacKey, "account", normalizedEmail);
  const sourceDigest = hmac(input.hmacKey, "source", summary);
  const combinedDigest = hmac(input.hmacKey, "combined", `${accountDigest}:${sourceDigest}`);

  return Object.freeze({
    accountDigest,
    sourceDigest,
    combinedDigest,
    sourceSummary: summary,
  });
}
