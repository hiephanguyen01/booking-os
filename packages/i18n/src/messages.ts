export const viMessages = {
  "storefront.title": "Cửa hàng đặt lịch",
  "storefront.description": "Khám phá và đặt dịch vụ theo thời gian phù hợp.",
  "console.title": "Bảng điều khiển Booking OS",
  "console.description": "Quản lý hoạt động đặt lịch từ một nơi thống nhất.",
  "api.status.title": "Trạng thái API",
  "api.status.healthy": "API đang hoạt động bình thường.",
  "api.status.degraded": "API hiện không khả dụng; giao diện vẫn hoạt động ở chế độ giới hạn.",
  "console.session.title": "Phiên minh họa",
  "console.permission.allowed": "Quyền truy cập được cho phép.",
  "console.permission.denied": "Quyền truy cập bị từ chối.",
} as const;

export type MessageKey = keyof typeof viMessages;

export const enMessages = {
  "storefront.title": "Booking storefront",
  "storefront.description": "Discover and book services for the time that suits you.",
  "console.title": "Booking OS console",
  "console.description": "Manage booking operations from one unified place.",
  "api.status.title": "API status",
  "api.status.healthy": "The API is operating normally.",
  "api.status.degraded":
    "The API is unavailable; the interface remains available in degraded mode.",
  "console.session.title": "Demonstration session",
  "console.permission.allowed": "Access is allowed.",
  "console.permission.denied": "Access is denied.",
} as const satisfies Record<MessageKey, string>;
