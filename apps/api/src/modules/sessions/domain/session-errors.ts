export class SessionUnavailableError extends Error {
  constructor() {
    super("Session is unavailable.");
    this.name = "SessionUnavailableError";
  }
}

export class SessionAuthorizationStaleError extends Error {
  constructor() {
    super("Session authorization snapshot is stale.");
    this.name = "SessionAuthorizationStaleError";
  }
}

export class SessionCompromisedError extends Error {
  constructor() {
    super("Session has been compromised.");
    this.name = "SessionCompromisedError";
  }
}
