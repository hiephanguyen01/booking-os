import { resolveAppConfig } from "../../app-config.js";
import { createSessionBffHandlers } from "./session-bff.js";

export const sessionBffHandlers = createSessionBffHandlers({
  apiBaseUrl: resolveAppConfig().apiBaseUrl,
  fetch,
});
