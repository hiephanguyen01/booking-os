import { InvitationInvalidOrExpiredError } from "../../domain/membership-errors.js";

export type ResolvePendingInvitationLoginInput = Readonly<{
  tenantId: string;
  userId: string;
  hostname: string;
}>;

interface CurrentInvitationReader {
  execute(input: ResolvePendingInvitationLoginInput): Promise<unknown>;
}

export class ResolvePendingInvitationLoginUseCase {
  constructor(private readonly currentInvitation: CurrentInvitationReader) {}

  async execute(input: ResolvePendingInvitationLoginInput): Promise<boolean> {
    try {
      await this.currentInvitation.execute(input);
      return true;
    } catch (error) {
      if (error instanceof InvitationInvalidOrExpiredError) {
        return false;
      }
      throw error;
    }
  }
}
