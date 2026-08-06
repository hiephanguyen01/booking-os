import { parseSessionToken } from "@booking-os/auth";

import { SessionUnavailableError } from "../../domain/session-errors.js";
import type {
  SessionRepositoryPort,
  SessionScope,
  StoredSession,
} from "../ports/session-repository.port.js";
import type { SessionSubjectPort } from "../ports/session-subject.port.js";
import type { ValidateSessionInput } from "./validate-session.js";

export interface GetCurrentSessionInput {
  readonly token: string;
  readonly hostname: string;
  readonly scope: SessionScope;
  readonly requestId: string;
}

export interface CurrentSession {
  readonly actorId: string;
  readonly sessionId: string;
  readonly authScope: SessionScope;
  readonly sessionState: Extract<StoredSession["state"], "active" | "invitation_pending">;
  readonly tokenDisposition: "active" | "overlap";
  readonly rotationRequired: boolean;
}

interface SessionValidator {
  execute(input: ValidateSessionInput): Promise<{
    readonly session: StoredSession;
    readonly tokenDisposition: "active" | "overlap";
    readonly rotationRequired: boolean;
  }>;
}

export class GetCurrentSessionUseCase {
  constructor(
    private readonly sessions: SessionRepositoryPort,
    private readonly subjects: SessionSubjectPort,
    private readonly validator: SessionValidator,
  ) {}

  async execute(input: GetCurrentSessionInput): Promise<CurrentSession> {
    const parsed = parseSessionToken(input.token);
    if (!parsed) {
      throw new SessionUnavailableError();
    }

    const stored = await this.sessions.findBySelector({
      selector: parsed.selector,
      hostname: input.hostname,
      scope: input.scope,
    });
    if (!stored) {
      throw new SessionUnavailableError();
    }

    const authorizationVersion = await this.subjects.currentAuthorizationVersion(
      stored.session.userId,
    );
    if (authorizationVersion === null) {
      throw new SessionUnavailableError();
    }

    const validated = await this.validator.execute({
      token: input.token,
      hostname: input.hostname,
      scope: input.scope,
      authorizationVersion,
      requestId: input.requestId,
    });
    if (validated.session.state !== "active" && validated.session.state !== "invitation_pending") {
      throw new SessionUnavailableError();
    }

    return {
      actorId: validated.session.userId,
      sessionId: validated.session.id,
      authScope: validated.session.scope,
      sessionState: validated.session.state,
      tokenDisposition: validated.tokenDisposition,
      rotationRequired: validated.rotationRequired,
    };
  }
}
