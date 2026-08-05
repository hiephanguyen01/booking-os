import { Global, Module } from "@nestjs/common";

import { ENVIRONMENT_TOKEN } from "./environment.constants.js";
import { parseEnvironment } from "./environment.js";
import { EnvironmentService } from "./environment.service.js";

const TEST_IDENTITY_ENVIRONMENT = Object.freeze({
  IDENTITY_TOKEN_PEPPER: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  IDENTITY_ENVELOPE_KEYS:
    '{"identity-v1":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="}',
  IDENTITY_ACTIVE_ENVELOPE_KEY_ID: "identity-v1",
  IDENTITY_BOOTSTRAP_ENABLED: "false",
});

function withTestIdentityDefaults(
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return source.NODE_ENV === "test" ? { ...TEST_IDENTITY_ENVIRONMENT, ...source } : source;
}

@Global()
@Module({
  providers: [
    {
      provide: ENVIRONMENT_TOKEN,
      useFactory: () => parseEnvironment(withTestIdentityDefaults(process.env)),
    },
    EnvironmentService,
  ],
  exports: [EnvironmentService],
})
export class EnvironmentModule {}
