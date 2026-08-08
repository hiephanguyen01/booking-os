import { membershipBffHandlers } from "../../../../../src/lib/membership/membership-route-runtime";

interface RouteContext {
  readonly params: Promise<{ readonly token: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  const forwarded = new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ token }),
  });
  return membershipBffHandlers.acceptInvitation(forwarded);
}
