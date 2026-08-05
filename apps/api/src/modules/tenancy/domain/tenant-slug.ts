import { isIP } from "node:net";

const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function tenantSlugFromHostname(hostname: string): string | undefined {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized.includes(".") || isIP(normalized) !== 0) {
    return undefined;
  }

  const labels = normalized.split(".");
  if (labels.some((label) => !HOST_LABEL_PATTERN.test(label))) {
    return undefined;
  }

  return labels[0];
}
