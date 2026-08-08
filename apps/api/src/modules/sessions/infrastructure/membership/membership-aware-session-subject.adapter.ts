import type {
  LoginSessionSubject,
  ResolveLoginSubjectInput,
  SessionSubjectPort,
} from "../../application/ports/session-subject.port.js";

interface PendingInvitationLoginResolver {
  execute(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly hostname: string;
  }): Promise<boolean>;
}

export class MembershipAwareSessionSubjectAdapter implements SessionSubjectPort {
  constructor(
    private readonly activeSubjects: SessionSubjectPort,
    private readonly pendingInvitations: PendingInvitationLoginResolver,
  ) {}

  async resolveForLogin(input: ResolveLoginSubjectInput): Promise<LoginSessionSubject | null> {
    const active = await this.activeSubjects.resolveForLogin(input);
    if (active) {
      return active;
    }
    if (input.scope.type !== "tenant") {
      return null;
    }

    const eligible = await this.pendingInvitations.execute({
      tenantId: input.scope.tenantId,
      userId: input.userId,
      hostname: input.hostname,
    });
    if (!eligible) {
      return null;
    }

    return Object.freeze({
      state: "invitation_pending" as const,
      authorizationVersion: 0,
    });
  }

  currentAuthorizationVersion(userId: string): Promise<number | null> {
    return this.activeSubjects.currentAuthorizationVersion(userId);
  }
}
