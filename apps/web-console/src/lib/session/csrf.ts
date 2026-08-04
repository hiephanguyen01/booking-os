const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function hasMatchingOrigin(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return true;
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) {
    return false;
  }

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function csrfOriginMismatchResponse(): Response {
  return Response.json(
    {
      error: {
        code: "CSRF_ORIGIN_MISMATCH",
        message: "The request origin does not match the console origin.",
      },
    },
    { status: 403 },
  );
}
