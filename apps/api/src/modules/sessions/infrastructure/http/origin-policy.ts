export interface EvaluateOriginInput {
  readonly origin: string | undefined;
  readonly allowedOrigins: readonly string[];
}

export interface OriginPolicyDecision {
  readonly allowed: boolean;
  readonly allowOrigin: string | undefined;
  readonly allowCredentials: boolean;
}

const REJECTED_ORIGIN: OriginPolicyDecision = {
  allowed: false,
  allowOrigin: undefined,
  allowCredentials: false,
};

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function assertValidAllowedOrigin(origin: string): void {
  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`Invalid allowed origin: ${origin}`);
  }

  const allowedProtocol =
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname));
  const isCanonicalOrigin =
    allowedProtocol &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.origin === origin;

  if (!isCanonicalOrigin) {
    throw new Error(`Invalid allowed origin: ${origin}`);
  }
}

export function evaluateOrigin(input: EvaluateOriginInput): OriginPolicyDecision {
  for (const allowedOrigin of input.allowedOrigins) {
    assertValidAllowedOrigin(allowedOrigin);
  }

  if (!input.origin || !input.allowedOrigins.includes(input.origin)) {
    return REJECTED_ORIGIN;
  }

  return {
    allowed: true,
    allowOrigin: input.origin,
    allowCredentials: true,
  };
}
