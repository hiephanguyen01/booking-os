import { resolveAppConfig } from "../../../../../src/app-config";
import { createIdentityBffHandlers } from "../../../../../src/lib/identity/identity-bff";

const handlers = createIdentityBffHandlers({ apiBaseUrl: resolveAppConfig().apiBaseUrl });

export const POST = handlers.activationComplete;
