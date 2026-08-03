import { ROLES, type Session } from "@booking-os/auth";

export const samplePartnerSession: Session = {
  user: {
    id: "partner-demo",
    email: "partner@example.com",
    displayName: "Partner Demo",
    role: ROLES.partner,
  },
  expiresAt: "2099-01-01T00:00:00.000Z",
};
