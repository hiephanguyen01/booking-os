export const PARTNER_ERROR_CODES = {
  invalidState: "PARTNER_INVALID_STATE",
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
