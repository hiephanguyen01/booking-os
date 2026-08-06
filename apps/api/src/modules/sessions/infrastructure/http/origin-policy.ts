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

function assertValidAllowedOrigin(origin: string): void {
  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`Invalid allowed origin: ${origin}`);
  }

  const isCanonicalHttpsOrigin =
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.origin === origin;

  if (!isCanonicalHttpsOrigin) {
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
