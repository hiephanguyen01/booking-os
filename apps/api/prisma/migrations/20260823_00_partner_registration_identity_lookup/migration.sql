-- Keep Partner registration identity lookup behind the global identity security boundary.
-- The tenant runtime role must not receive direct SELECT privileges on public.users.

CREATE OR REPLACE FUNCTION "partner_registration_lookup_identity"(
  p_normalized_email text
)
RETURNS TABLE (
  user_id uuid,
  status text,
  authorization_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    user_row."id",
    user_row."status"::text,
    user_row."authorization_version"
  FROM public."users" AS user_row
  WHERE user_row."normalized_email" = p_normalized_email
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION "partner_registration_lookup_identity"(text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "partner_registration_lookup_identity"(text)
TO booking_app;
