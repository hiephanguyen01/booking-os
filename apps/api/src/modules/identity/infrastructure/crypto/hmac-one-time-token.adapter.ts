import {
  createOneTimeToken,
  parseOneTimeToken,
  verifyOneTimeTokenSecret,
} from "@booking-os/auth";

import type {
  IssuedOneTimeToken,
  OneTimeTokenPort,
  VerifiedOneTimeToken,
} from "../../application/ports/one-time-token.port.js";

export class HmacOneTimeTokenAdapter implements OneTimeTokenPort {
  private readonly pepper: Uint8Array;

  constructor(pepper: Uint8Array) {
    this.pepper = Buffer.from(pepper);
  }

  issue(purpose: string): IssuedOneTimeToken {
    const token = createOneTimeToken({ pepper: this.pepper, purpose });

    return Object.freeze({
      selector: token.selector,
      serialized: token.serialized,
      tokenHash: token.secretDigest,
    });
  }

  verify(
    serialized: string,
    purpose: string,
    expectedTokenHash: string,
  ): VerifiedOneTimeToken | null {
    const parsed = parseOneTimeToken(serialized);

    if (
      !parsed ||
      !verifyOneTimeTokenSecret({
        pepper: this.pepper,
        purpose,
        secret: parsed.secret,
        expectedDigest: expectedTokenHash,
      })
    ) {
      return null;
    }

    return Object.freeze({ selector: parsed.selector });
  }
}
