import { csrfOriginMismatchResponse, hasMatchingOrigin } from "./src/lib/session/csrf.js";

export function middleware(request: Request): Response | undefined {
  return hasMatchingOrigin(request) ? undefined : csrfOriginMismatchResponse();
}

export const config = {
  matcher: "/api/:path*",
};
