import { resolveAppConfig } from "../../app-config";
import { createSessionBffHandlers } from "./session-bff";

export const sessionBffHandlers = createSessionBffHandlers({
  apiBaseUrl: resolveAppConfig().apiBaseUrl,
  fetch,
});
