export const PERMISSIONS = {
  platformManage: "platform:manage",
  tenantManage: "tenant:manage",
  listingManage: "listing:manage",
  bookingView: "booking:view",
  affiliateView: "affiliate:view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
