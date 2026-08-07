REVOKE ALL PRIVILEGES ON TABLE "roles" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "permissions" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE "role_permissions" FROM PUBLIC;

REVOKE ALL PRIVILEGES ON TABLE "roles" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "permissions" FROM booking_app;
REVOKE ALL PRIVILEGES ON TABLE "role_permissions" FROM booking_app;
GRANT SELECT ON TABLE "roles" TO booking_app;
GRANT SELECT ON TABLE "permissions" TO booking_app;
GRANT SELECT ON TABLE "role_permissions" TO booking_app;

REVOKE ALL PRIVILEGES ON TABLE "roles" FROM booking_platform_app;
REVOKE ALL PRIVILEGES ON TABLE "permissions" FROM booking_platform_app;
REVOKE ALL PRIVILEGES ON TABLE "role_permissions" FROM booking_platform_app;
GRANT SELECT ON TABLE "roles" TO booking_platform_app;
GRANT SELECT ON TABLE "permissions" TO booking_platform_app;
GRANT SELECT ON TABLE "role_permissions" TO booking_platform_app;
