import { resolveAppConfig } from "../../app-config";
import { createMembershipBffHandlers } from "./membership-bff";

export const membershipBffHandlers = createMembershipBffHandlers({
  apiBaseUrl: resolveAppConfig().apiBaseUrl,
  fetch,
});
