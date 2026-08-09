export type HostHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

function firstHeaderValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function stripPort(hostname: string): string {
  const bracketed = /^\[([^\]]+)](?::\d+)?$/.exec(hostname);
  if (bracketed) {
    return bracketed[1] ?? hostname;
  }

  return hostname.replace(/:\d+$/, "");
}

export function effectiveHostname(headers: HostHeaders, trustProxy: boolean): string | undefined {
  const forwarded = firstHeaderValue(headers["x-forwarded-host"]);
  const direct = firstHeaderValue(headers.host);
  const selected = trustProxy && forwarded ? forwarded.split(",", 1)[0] : direct;
  const normalized = selected?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return stripPort(normalized);
}
