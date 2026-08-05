import { ApiError } from "../../../../common/errors/api-error.js";
import type {
  IdentityPublicCsrfPort,
  IdentityPublicHttpRequest,
} from "./identity-public.controller.js";
import type {
  IssuedPreAuthCsrf,
  PreAuthCsrfPurpose,
  PreAuthCsrfService,
} from "./pre-auth-csrf.js";

const IDENTITY_CSRF_ERROR_MESSAGE = "The identity request could not be verified.";

export class IdentityCsrfInvalidError extends ApiError {
  constructor() {
    super({
      code: "identity.csrf.invalid",
      message: IDENTITY_CSRF_ERROR_MESSAGE,
      statusCode: 403,
    });
    this.name = "IdentityCsrfInvalidError";
  }
}

export class IdentityPublicCsrfAdapter implements IdentityPublicCsrfPort {
  constructor(private readonly csrf: PreAuthCsrfService) {}

  issue(input: {
    readonly hostname: string;
    readonly purpose: PreAuthCsrfPurpose;
  }): IssuedPreAuthCsrf {
    return this.csrf.issue(input);
  }

  assertRequest(request: IdentityPublicHttpRequest, purpose: PreAuthCsrfPurpose): void {
    const validOrigin = request.origin !== null && request.origin === request.expectedOrigin;
    const validProof =
      request.csrfCookie !== null &&
      request.csrfToken !== null &&
      this.csrf.verify({
        hostname: request.hostname,
        purpose,
        nonce: request.csrfCookie,
        token: request.csrfToken,
      });

    if (!validOrigin || !validProof) {
      throw new IdentityCsrfInvalidError();
    }
  }
}
