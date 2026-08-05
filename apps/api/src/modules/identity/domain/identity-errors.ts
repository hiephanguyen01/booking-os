export type IdentityErrorCode = "identity.email_conflict" | "identity.token_invalid";

export abstract class IdentityError extends Error {
  readonly code: IdentityErrorCode;

  protected constructor(code: IdentityErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class IdentityEmailConflictError extends IdentityError {
  constructor() {
    super("identity.email_conflict", "An identity already exists for this email address.");
  }
}

export class IdentityTokenInvalidError extends IdentityError {
  constructor() {
    super("identity.token_invalid", "The identity token is invalid or unavailable.");
  }
}
