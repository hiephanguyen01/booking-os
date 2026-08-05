import { isIP } from "node:net";

const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizedDomain(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized.includes(".") || isIP(normalized) !== 0) {
    return undefined;
  }

  const labels = normalized.split(".");
  if (labels.some((label) => !HOST_LABEL_PATTERN.test(label))) {
    return undefined;
  }

  return normalized;
}

export function tenantSlugFromHostname(
  hostname: string,
  tenantBaseDomain: string,
): string | undefined {
  const normalizedHostname = normalizedDomain(hostname);
  const normalizedBaseDomain = normalizedDomain(tenantBaseDomain);
  if (!normalizedHostname || !normalizedBaseDomain) {
    return undefined;
  }

  const suffix = `.${normalizedBaseDomain}`;
  if (!normalizedHostname.endsWith(suffix)) {
    return undefined;
  }

  const slug = normalizedHostname.slice(0, -suffix.length);
  return HOST_LABEL_PATTERN.test(slug) ? slug : undefined;
}
