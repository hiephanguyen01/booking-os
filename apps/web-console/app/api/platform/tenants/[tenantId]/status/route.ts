import { membershipBffHandlers } from "../../../../../../src/lib/membership/membership-route-runtime";

interface RouteContext {
  readonly params: Promise<{ readonly tenantId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { tenantId } = await context.params;
  return membershipBffHandlers.getPlatformTenantStatus(request, tenantId);
}
