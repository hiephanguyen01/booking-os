export const PARTNER_ERROR_CODES = {
  invalidState: "PARTNER_INVALID_STATE",
  notFound: "PARTNER_NOT_FOUND",
  staleVersion: "PARTNER_STALE_VERSION",
} as const;

export type PartnerErrorCode = (typeof PARTNER_ERROR_CODES)[keyof typeof PARTNER_ERROR_CODES];

export class PartnerError extends Error {
  readonly code: PartnerErrorCode;

  constructor(code: PartnerErrorCode) {
    super(code);
    this.code = code;
    this.name = new.target.name;
  }
}

export class PartnerInvalidStateError extends PartnerError {
  constructor() {
    super(PARTNER_ERROR_CODES.invalidState);
  }
}

export class PartnerNotFoundError extends PartnerError {
  constructor() {
    super(PARTNER_ERROR_CODES.notFound);
  }
}

export class PartnerStaleVersionError extends PartnerError {
  constructor() {
    super(PARTNER_ERROR_CODES.staleVersion);
  }
}
