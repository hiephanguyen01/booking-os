-- Platform authorization resolves only the immutable user identity columns
-- needed to validate an active authorization snapshot. Keep email and other
-- identity data unavailable to the non-bypass platform application role.
GRANT SELECT ("id", "status", "authorization_version")
  ON TABLE "users"
  TO booking_platform_app;
