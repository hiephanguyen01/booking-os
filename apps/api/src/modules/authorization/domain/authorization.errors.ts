export class AuthorizationSessionIneligibleError extends Error {
  constructor() {
    super("The session cannot establish an authorization context.");
    this.name = "AuthorizationSessionIneligibleError";
  }
}

export class AuthorizationSubjectInactiveError extends Error {
  constructor() {
    super("The authorization subject is inactive.");
    this.name = "AuthorizationSubjectInactiveError";
  }
}

export class AuthorizationAuthorityInvalidError extends Error {
  constructor() {
    super("The authoritative role or permission catalog is invalid.");
    this.name = "AuthorizationAuthorityInvalidError";
  }
}
