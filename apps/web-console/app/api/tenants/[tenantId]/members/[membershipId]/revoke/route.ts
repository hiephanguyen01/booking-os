import { membershipBffHandlers } from "../../../../../../../src/lib/membership/membership-route-runtime";

interface RouteContext {
  readonly params: Promise<{ readonly membershipId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { membershipId } = await context.params;
  return membershipBffHandlers.revokeMembership(request, membershipId);
}
